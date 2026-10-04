import {
  CommandId,
  CommandReceipt,
  Objective,
  type AgentId as AgentIdT,
  type CommandStatus,
  type EvidenceReference,
  type ObjectiveKind,
} from "@ember/domain";
import { AgentId, ObjectiveId, SequenceNumber, SimTimeMs } from "@ember/domain";
import { matchName, type Directory, type IntentEnvelope } from "./intent.js";
import type { Interpreter } from "./interpreter.js";

/** A report the coordinator actually received: a sensor observation or an agent's own report. */
export interface Report {
  readonly id: string;
  readonly kind: "sensor_observation" | "agent_report";
  readonly sourceAgentId: string;
  readonly timeMs: number;
  readonly text: string;
  readonly footprint?: { x: number; y: number; radius: number };
}

export interface AgentStatus {
  readonly callsign: string;
  readonly currentAction: string | null;
  readonly objective: string | null;
  readonly returnEstimateSec: number | null;
  readonly lastRejection: string | null;
  readonly knownConditions: string | null;
  readonly lastReport: string | null;
}

export type GatewayAction =
  | { readonly kind: "set_recipient"; readonly recipientId: AgentIdT }
  | { readonly kind: "relay"; readonly observationId: string; readonly toAgentId: AgentIdT; readonly evidence: EvidenceReference }
  | { readonly kind: "objective"; readonly objective: Objective }
  | { readonly kind: "resume_autonomous"; readonly agentId: AgentIdT };

export interface GatewayOutcome {
  readonly receipt: CommandReceipt;
  readonly actions: readonly GatewayAction[];
  /** Plain-language acknowledgement of what the server did with the message. */
  readonly reply: string;
  readonly evidence: readonly EvidenceReference[];
  /** Simulated time the command was evaluated: always the current tick, never the utterance time. */
  readonly evaluatedAtSimMs: number;
  readonly notes: readonly string[];
}

export interface GatewayEnv {
  readonly directory: Directory;
  readonly interpreter: Interpreter;
  readonly picture: () => readonly Report[];
  readonly status: (agentId: string) => AgentStatus | null;
  readonly nowSimMs: () => number;
  readonly incidentEnded: () => boolean;
}

export interface IncomingMessage {
  readonly commandId: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly wallMs: number;
}

export interface Ticket {
  readonly inputSequence: number;
  readonly duplicate: boolean;
  readonly outcomes: readonly GatewayOutcome[];
}

export type GatewayNotice = { readonly kind: "still_interpreting"; readonly commandId: string };

interface Pending {
  readonly message: IncomingMessage;
  readonly sequence: number;
  envelope: IntentEnvelope | null;
  status: "interpreting" | "ready" | "failed";
  noticed: boolean;
}

const STILL_INTERPRETING_MS = 5000;

/** Matches authoritative sim grid (64×25 m); communication must not depend on @ember/simulation. */
function gridCellIndexFromMeters(x: number, y: number): number | null {
  const cellMeters = 25;
  const gridSize = 64;
  const gx = Math.floor(x / cellMeters);
  const gy = Math.floor(y / cellMeters);
  if (gx < 0 || gy < 0 || gx >= gridSize || gy >= gridSize) return null;
  return gy * gridSize + gx;
}
/** Wall-clock bound for one interpretation. Provider calls must abort on this same deadline. */
export const INTERPRETATION_DEADLINE_MS = 10_000;

const KIND_OF: Record<string, ObjectiveKind | undefined> = {
  protect: "protect_site",
  contain: "contain_fire",
  observe: "scout_location",
  return: "return_to_refuge",
  hold: "hold",
  avoid: "avoid_corridor",
  move: "move_direction",
  line: "build_line",
};

/**
 * Turns interpreted coordinator messages into validated, idempotent actions. The model proposes;
 * this class resolves recipients and evidence in input order, never fabricates observations, and
 * leaves feasibility to the receiving agent's own checks.
 */
export class CommandGateway {
  private active: string | null = null;
  private revision = 0;
  private nextSeq = 0;
  private nextToResolve = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly byKey = new Map<string, { sequence: number; outcome: GatewayOutcome | null }>();
  private clarification: { question: string; envelope: IntentEnvelope } | null = null;
  private readonly notices: GatewayNotice[] = [];

  constructor(private readonly env: GatewayEnv) {}

  get activeRecipientId(): string | null {
    return this.active;
  }

  get recipientRevision(): number {
    return this.revision;
  }

  get pendingClarification(): string | null {
    return this.clarification?.question ?? null;
  }

  takeNotices(): GatewayNotice[] {
    return this.notices.splice(0, this.notices.length);
  }

  /** Accept a message. Retrying the same idempotency key never repeats an action. */
  submit(message: IncomingMessage): Ticket {
    const seen = this.byKey.get(message.idempotencyKey);
    if (seen !== undefined) {
      return { inputSequence: seen.sequence, duplicate: true, outcomes: seen.outcome === null ? [] : [seen.outcome] };
    }
    const sequence = this.nextSeq++;
    this.byKey.set(message.idempotencyKey, { sequence, outcome: null });
    if (this.env.incidentEnded()) {
      const outcome = this.finish(message, sequence, "incident_ended", null, [], "The incident has ended; the command was not applied.", [], []);
      return { inputSequence: sequence, duplicate: false, outcomes: [outcome] };
    }
    const pending: Pending = { message, sequence, envelope: null, status: "interpreting", noticed: false };
    this.pending.set(sequence, pending);
    const proposed = this.env.interpreter.interpret({
      commandId: message.commandId,
      inputSequence: sequence,
      text: message.text,
      directory: this.env.directory,
      activeRecipientCallsign: this.callsign(this.active),
    });
    if (proposed !== null) {
      pending.envelope = proposed;
      pending.status = "ready";
    }
    return { inputSequence: sequence, duplicate: false, outcomes: this.resolveReady() };
  }

  /** A provider answer that arrived later than submit. Late answers for failed inputs are ignored. */
  deliver(sequence: number, envelope: IntentEnvelope): GatewayOutcome[] {
    const p = this.pending.get(sequence);
    if (p === undefined) return [];
    if (p.status === "failed") return [];
    p.envelope = envelope;
    p.status = "ready";
    return this.resolveReady();
  }

  /** Real-time progress: "still interpreting" after 5 s, failed after 10 s. */
  poll(wallMs: number): GatewayOutcome[] {
    const out: GatewayOutcome[] = [];
    for (const p of this.pending.values()) {
      if (p.status !== "interpreting") continue;
      const waited = wallMs - p.message.wallMs;
      if (waited >= INTERPRETATION_DEADLINE_MS) {
        p.status = "failed";
        this.env.interpreter.cancel?.(p.sequence);
        out.push(
          this.finish(p.message, p.sequence, "rejected", null, [], "Interpretation failed. Nothing was applied; please resend by text.", [], ["interpretation_timeout"]),
        );
      } else if (waited >= STILL_INTERPRETING_MS && !p.noticed) {
        p.noticed = true;
        this.notices.push({ kind: "still_interpreting", commandId: p.message.commandId });
      }
    }
    out.push(...this.resolveReady());
    return out;
  }

  /** The incident ended: cancel everything not yet applied. */
  endIncident(): GatewayOutcome[] {
    this.env.interpreter.cancelAll?.();
    const out: GatewayOutcome[] = [];
    for (const p of [...this.pending.values()]) {
      if (p.status === "failed") continue;
      out.push(this.finish(p.message, p.sequence, "incident_ended", null, [], "The incident ended before this command was applied.", [], []));
    }
    this.pending.clear();
    this.clarification = null;
    return out;
  }

  private resolveReady(): GatewayOutcome[] {
    const out: GatewayOutcome[] = [];
    for (;;) {
      const p = this.pending.get(this.nextToResolve);
      if (p === undefined) {
        if (this.nextToResolve < this.nextSeq && !this.pending.has(this.nextToResolve)) {
          this.nextToResolve += 1;
          continue;
        }
        break;
      }
      if (p.status === "interpreting") break;
      this.pending.delete(p.sequence);
      this.nextToResolve += 1;
      if (p.status === "failed" || p.envelope === null) continue;
      out.push(this.resolve(p.message, p.sequence, p.envelope));
    }
    return out;
  }

  // ---------- resolution in input order ----------

  private callsign(id: string | null): string | null {
    return id === null ? null : (this.env.directory.agents.find((a) => a.id === id)?.callsign ?? null);
  }

  private resolve(message: IncomingMessage, seq: number, raw: IntentEnvelope): GatewayOutcome {
    if (this.env.incidentEnded()) {
      return this.finish(message, seq, "incident_ended", null, [], "The incident has ended; the command was not applied.", [], []);
    }
    let env = raw;
    if (raw.kind === "clarification_answer" && this.clarification !== null) {
      env = { ...this.clarification.envelope, ...mergeAnswer(this.clarification.envelope, raw), commandId: raw.commandId, inputSequence: raw.inputSequence };
      this.clarification = null;
    }
    const actions: GatewayAction[] = [];
    const notes: string[] = [];

    if (env.clarification !== undefined) return this.ask(message, seq, env, env.clarification);
    if (env.objective?.kind === "line" && (env.objective.crews?.length ?? 0) > 0) {
      return this.resolveLine(message, seq, env, null, actions);
    }

    // Recipient: an explicit name overrides; otherwise the active recipient as resolved so far.
    let recipient = this.active;
    if (env.explicitRecipient !== undefined) {
      const m = matchName(env.explicitRecipient, this.env.directory.agents.map((a) => ({ id: a.id, name: a.callsign })));
      if (m.kind !== "unique") {
        return this.ask(message, seq, env, m.kind === "ambiguous" ? "Which crew do you mean?" : this.unknownRecipient(env.explicitRecipient));
      }
      recipient = m.id;
      if (recipient !== this.active) {
        this.active = recipient;
        this.revision += 1;
        actions.push({ kind: "set_recipient", recipientId: AgentId.parse(recipient) });
      }
    }
    if (recipient === null) return this.ask(message, seq, env, "Which crew is this for?");
    const agent = this.env.directory.agents.find((a) => a.id === recipient)!;
    const recipientId = AgentId.parse(recipient);
    const now = this.env.nowSimMs();

    if (env.kind === "status") {
      const status = this.env.status(recipient);
      return this.finish(message, seq, "accepted", recipientId, actions, statusReply(agent.callsign, status), [], ["status_query"], now);
    }

    // Evidence is resolved only from what the coordinator actually received.
    const evidence: EvidenceReference[] = [];
    const relayed: string[] = [];
    for (const q of env.evidenceQueries) {
      const found = this.resolveEvidence(q);
      if (found.kind !== "ok") {
        return this.ask(message, seq, env, found.question, actions);
      }
      const r = found.report;
      evidence.push({
        kind: r.kind,
        sourceRecordId: r.id,
        sourceAgentId: AgentId.parse(r.sourceAgentId),
        timestamp: SimTimeMs.parse(r.timeMs),
      });
      if (r.kind === "sensor_observation") {
        actions.push({ kind: "relay", observationId: r.id, toAgentId: recipientId, evidence: evidence[evidence.length - 1]! });
        relayed.push(`${this.callsign(r.sourceAgentId) ?? r.sourceAgentId} observation from ${Math.round(r.timeMs / 1000)} s`);
      } else {
        notes.push("agent_report_not_converted_to_observation");
      }
    }
    for (const claim of env.unsupportedClaims) notes.push(`unsupported_claim:${claim}`);

    if (env.objective?.kind === "line") return this.resolveLine(message, seq, env, recipientId, actions);

    let objectiveText = "";
    let rejectedObjective: string | null = null;
    if (env.objective !== undefined) {
      const o = env.objective;
      if (o.kind === "resume") {
        actions.push({ kind: "resume_autonomous", agentId: recipientId });
        objectiveText = `${agent.callsign} resumes independent selection.`;
      } else {
        const kind = KIND_OF[o.kind]!;
        let targetId: string | null = null;
        let targetLabel = "";
        if (o.kind === "protect" || o.kind === "avoid" || o.kind === "contain") {
          const pool =
            o.kind === "protect"
              ? this.env.directory.sites.map((s) => ({ id: s.id, name: s.name }))
              : o.kind === "contain"
                ? this.env.directory.locations.map((l) => ({ id: String(l.name), name: l.name }))
                : this.env.directory.corridors.map((s) => ({ id: s.id, name: s.name }));
          if (o.targetName === undefined) {
            return this.ask(
              message,
              seq,
              env,
              o.kind === "protect"
                ? "Which site should it protect?"
                : o.kind === "contain"
                  ? "Which fire location should it contain?"
                  : "Which corridor should it avoid?",
              actions,
            );
          }
          const m = matchName(o.targetName, pool);
          if (m.kind !== "unique") {
            return this.ask(
              message,
              seq,
              env,
              m.kind === "ambiguous"
                ? `Which one: ${m.ids.join(" or ")}?`
                : `I don't know a ${o.kind === "protect" ? "site" : o.kind === "contain" ? "location" : "corridor"} called ${o.targetName}.`,
              actions,
            );
          }
          if (o.kind === "contain") {
            const loc = this.env.directory.locations.find((l) => l.name === m.id);
            if (loc === undefined) {
              return this.ask(message, seq, env, `I don't know a location called ${o.targetName}.`, actions);
            }
            const cell = gridCellIndexFromMeters(loc.x, loc.y);
            if (cell === null) {
              return this.ask(message, seq, env, "That location is not on the fire grid.", actions);
            }
            targetId = String(cell);
            targetLabel = loc.name;
          } else {
            targetId = m.id;
            targetLabel = pool.find((p) => p.id === m.id)!.name;
          }
        }
        if (o.kind === "move" && o.direction === undefined) {
          return this.ask(message, seq, env, "Which compass direction should the crew move?", actions);
        }
        if (o.kind === "protect" && agent.role !== "protection_crew") {
          rejectedObjective = `${agent.callsign} does not do protection work.`;
        } else if (o.kind === "contain" && agent.role !== "protection_crew") {
          rejectedObjective = `${agent.callsign} does not perform containment work.`;
        } else if (o.kind === "observe") {
          rejectedObjective = "there is no scout in this incident, so observation orders are not supported.";
        } else if (o.kind === "avoid" && agent.role !== "protection_crew") {
          rejectedObjective = `${agent.callsign} cannot take corridor-avoidance orders.`;
        } else {
          let constraints: Objective["constraints"] = {};
          if (o.kind === "contain" && targetId !== null) {
            const cell = Number.parseInt(targetId, 10);
            if (Number.isFinite(cell)) constraints = { gridCellIndex: cell };
          }
          const objective = Objective.parse({
            id: ObjectiveId.parse(`obj-${seq}`),
            recipientId,
            kind,
            targetId,
            constraints,
            ...(o.kind === "move" && o.direction !== undefined
              ? { movement: { direction: o.direction, ...(o.maxDistanceMeters === undefined ? {} : { maxDistanceMeters: o.maxDistanceMeters }) } }
              : {}),
            issueSequence: SequenceNumber.parse(seq),
          });
          actions.push({ kind: "objective", objective });
          objectiveText = o.kind === "move"
            ? `Sent to ${agent.callsign}: move ${objective.movement?.direction} up to ${objective.movement?.maxDistanceMeters} m. Its own feasibility check decides.`
            : `Sent to ${agent.callsign}: ${o.kind}${targetLabel === "" ? "" : ` ${targetLabel}`}. Its own feasibility check decides.`;
        }
      }
    }
    if (env.objective === undefined && relayed.length === 0 && env.unsupportedClaims.length > 0) {
      return this.finish(
        message,
        seq,
        "rejected",
        recipientId,
        actions,
        "That claim is not backed by a report, so no hazard was changed and nothing was relayed.",
        [],
        notes,
        now,
      );
    }
    if (env.objective === undefined && relayed.length === 0 && env.kind !== "relay") {
      return this.ask(message, seq, env, "I could not tell what you want done. Which action should I send?", actions);
    }
    const parts: string[] = [];
    if (relayed.length > 0) parts.push(`Passed ${relayed.join(" and ")} to ${agent.callsign}.`);
    if (objectiveText !== "") parts.push(objectiveText);
    if (rejectedObjective !== null) parts.push(`Objective rejected: ${rejectedObjective}`);
    if (env.unsupportedClaims.length > 0) parts.push("That claim is not backed by a report, so no hazard was changed.");
    const status: CommandStatus = rejectedObjective !== null && actions.every((a) => a.kind === "set_recipient") ? "rejected" : "accepted";
    return this.finish(message, seq, status, recipientId, actions, parts.join(" "), evidence, notes, now);
  }

  /**
   * A fire-line order. For now the line must run from a named place to another named place: the
   * gateway turns the two places into points, and each crew gets its own objective starting at its
   * end. Crews do not wait for each other. `recipientId` is the single addressee when the message
   * names no crews.
   */
  private resolveLine(
    message: IncomingMessage,
    seq: number,
    env: IntentEnvelope,
    recipientId: AgentIdT | null,
    actions: GatewayAction[],
  ): GatewayOutcome {
    const o = env.objective!;
    const places = this.env.directory.places ?? [];
    const place = (name: string | undefined): { kind: "ok"; id: string; name: string } | { kind: "ask"; question: string } => {
      if (name === undefined) return { kind: "ask", question: "Between which two places should the fire line run?" };
      const m = matchName(name, places);
      if (m.kind === "unique") return { kind: "ok", id: m.id, name: places.find((p) => p.id === m.id)!.name };
      return { kind: "ask", question: m.kind === "ambiguous" ? `Which place do you mean by ${name}?` : `I don't know a place called ${name}.` };
    };
    const from = place(o.anchor?.placeName);
    if (from.kind === "ask") return this.ask(message, seq, env, from.question, actions);
    if (o.anchor?.offsetMeters !== undefined || o.anchor?.offsetDirection !== undefined) {
      return this.ask(message, seq, env, "A fire line must start at a named place for now. Where should it start?", actions);
    }
    if (o.course !== undefined && o.course.kind !== "to_place") {
      return this.ask(message, seq, env, "A fire line must run to a named place for now. Where should it end?", actions);
    }
    const to = place(o.course?.placeName);
    if (to.kind === "ask") return this.ask(message, seq, env, to.question, actions);
    if (from.id === to.id) return this.ask(message, seq, env, "A fire line needs two different places. Where should it end?", actions);

    const crews = this.env.directory.agents.map((a) => ({ id: a.id, name: a.callsign }));
    const orders: { agentId: string; startId: string }[] = [];
    if (o.crews !== undefined && o.crews.length > 0) {
      for (const assigned of o.crews) {
        const crew = matchName(assigned.recipient, crews);
        if (crew.kind !== "unique") return this.ask(message, seq, env, this.unknownRecipient(assigned.recipient), actions);
        const end = assigned.end;
        if (typeof end === "object" && "compass" in end) {
          return this.ask(message, seq, env, `Name the end ${assigned.recipient} should start from by place: ${from.name} or ${to.name}.`, actions);
        }
        if (end === "start") {
          orders.push({ agentId: crew.id, startId: from.id });
        } else if (end === "far") {
          orders.push({ agentId: crew.id, startId: to.id });
        } else {
          const start = place(end.placeName);
          if (start.kind === "ask") return this.ask(message, seq, env, start.question, actions);
          if (start.id !== from.id && start.id !== to.id) {
            return this.ask(message, seq, env, `${end.placeName} is not an end of the line from ${from.name} to ${to.name}. Which end should ${assigned.recipient} start from?`, actions);
          }
          orders.push({ agentId: crew.id, startId: start.id });
        }
      }
    } else if (recipientId !== null) {
      orders.push({ agentId: recipientId, startId: from.id });
    } else {
      return this.ask(message, seq, env, "Which crew should cut the fire line?", actions);
    }

    const parts: string[] = [];
    const now = this.env.nowSimMs();
    for (const order of orders) {
      const agent = this.env.directory.agents.find((a) => a.id === order.agentId)!;
      if (agent.role !== "protection_crew") {
        parts.push(`${agent.callsign} does not cut fire lines.`);
        continue;
      }
      const startName = order.startId === from.id ? from.name : to.name;
      const endName = order.startId === from.id ? to.name : from.name;
      const startPlace = places.find((p) => p.id === order.startId)!;
      const endPlace = places.find((p) => p.id === (order.startId === from.id ? to.id : from.id))!;
      const objective = Objective.parse({
        id: ObjectiveId.parse(`obj-${seq}-${agent.id}`),
        recipientId: AgentId.parse(agent.id),
        kind: "build_line",
        targetId: null,
        constraints: { line: { start: { x: startPlace.x, y: startPlace.y }, end: { x: endPlace.x, y: endPlace.y } } },
        issueSequence: SequenceNumber.parse(seq),
      });
      actions.push({ kind: "objective", objective });
      parts.push(`Sent to ${agent.callsign}: cut a fire line from ${startName} toward ${endName}.`);
    }
    const sent = actions.some((a) => a.kind === "objective");
    if (sent) parts.push(orders.length > 1 ? "Each crew starts on its own; their own feasibility checks decide." : "Its own feasibility check decides.");
    const receiptRecipient = AgentId.parse(orders[0]!.agentId);
    return this.finish(message, seq, sent ? "accepted" : "rejected", receiptRecipient, actions, parts.join(" "), [], [], now);
  }

  /** Question for a named recipient that is not in the directory; scouts no longer exist in new incidents. */
  private unknownRecipient(heard: string): string {
    const known = this.env.directory.agents.map((a) => a.callsign).join(", ");
    if (/\bscouts?\b/i.test(heard)) return `There is no scout in this incident. Known callsigns: ${known}.`;
    return `I don't have a crew called ${heard}. Known callsigns: ${known}.`;
  }

  private ask(message: IncomingMessage, seq: number, env: IntentEnvelope, question: string, actions: readonly GatewayAction[] = []): GatewayOutcome {
    this.clarification = { question, envelope: env };
    // `this.active` has already moved when the message named a crew; the incident must see that
    // switch too, or the next command to the same crew (now "already active") never emits one.
    const keep = actions.filter((a) => a.kind === "set_recipient");
    return this.finish(message, seq, "clarification_required", null, keep, question, [], ["clarification"]);
  }

  private resolveEvidence(
    q: IntentEnvelope["evidenceQueries"][number],
  ): { kind: "ok"; report: Report } | { kind: "ask"; question: string } {
    const dir = this.env.directory;
    let source: string | null = null;
    if (q.sourceName !== undefined) {
      const m = matchName(q.sourceName, dir.agents.map((a) => ({ id: a.id, name: a.callsign })));
      if (m.kind !== "unique") return { kind: "ask", question: `Whose report do you mean by ${q.sourceName}?` };
      source = m.id;
    }
    const loc = q.locationName === undefined ? null : dir.locations.find((l) => l.name.toLowerCase() === q.locationName!.toLowerCase());
    if (q.locationName !== undefined && loc === undefined) return { kind: "ask", question: `I don't know a place called ${q.locationName}.` };
    let candidates = this.env.picture().filter((r) => {
      if (source !== null && r.sourceAgentId !== source) return false;
      if (loc !== null && loc !== undefined) {
        if (r.footprint === undefined) return false;
        if (Math.hypot(r.footprint.x - loc.x, r.footprint.y - loc.y) > loc.radius + r.footprint.radius) return false;
      }
      return true;
    });
    if (q.referencedReportId !== undefined) {
      candidates = candidates.filter((r) => r.id === q.referencedReportId);
    }
    const label = [q.sourceName, q.locationName].filter(Boolean).join(" / ") || "that";
    if (candidates.length === 0) return { kind: "ask", question: `I have no received report matching ${label}. Which report do you mean?` };
    if (q.timeSelector === "latest" || candidates.length === 1) {
      const newest = Math.max(...candidates.map((c) => c.timeMs));
      const top = candidates.filter((c) => c.timeMs === newest);
      if (top.length === 1) return { kind: "ok", report: top[0]! };
      return { kind: "ask", question: `Several reports match ${label} at the same time. Which one?` };
    }
    return { kind: "ask", question: `More than one report matches ${label}. Which one do you mean?` };
  }

  private finish(
    message: IncomingMessage,
    seq: number,
    status: CommandStatus,
    recipient: AgentIdT | null,
    actions: readonly GatewayAction[],
    reply: string,
    evidence: readonly EvidenceReference[],
    notes: readonly string[],
    evaluatedAt: number = this.env.nowSimMs(),
  ): GatewayOutcome {
    const applied = status === "accepted";
    const outcome: GatewayOutcome = {
      receipt: CommandReceipt.parse({
        commandId: CommandId.parse(message.commandId),
        status,
        recipientId: recipient,
        appliedTick: applied ? SimTimeMs.parse(evaluatedAt) : null,
        explanation: reply,
        planRevision: null,
      }),
      actions,
      reply,
      evidence,
      evaluatedAtSimMs: evaluatedAt,
      notes,
    };
    const entry = this.byKey.get(message.idempotencyKey);
    if (entry !== undefined) entry.outcome = outcome;
    void seq;
    return outcome;
  }
}

function mergeAnswer(original: IntentEnvelope, answer: IntentEnvelope): Partial<IntentEnvelope> {
  const out: Partial<IntentEnvelope> = {};
  const { clarification: _dropped, ...rest } = original;
  void _dropped;
  Object.assign(out, rest);
  if (answer.explicitRecipient !== undefined) out.explicitRecipient = answer.explicitRecipient;
  if (answer.objective?.targetName !== undefined && original.objective !== undefined) {
    out.objective = { ...original.objective, targetName: answer.objective.targetName };
  }
  if (answer.objective?.direction !== undefined && original.objective !== undefined) {
    out.objective = { ...original.objective, direction: answer.objective.direction };
  }
  return out;
}

export function statusReply(callsign: string, s: AgentStatus | null): string {
  if (s === null) return `${callsign} has nothing to report.`;
  const parts: string[] = [];
  if (s.currentAction !== null) parts.push(`${callsign} is ${s.currentAction}.`);
  if (s.objective !== null) parts.push(`Objective: ${s.objective}.`);
  if (s.returnEstimateSec !== null) parts.push(`Return estimate: ${Math.round(s.returnEstimateSec)} incident seconds.`);
  if (s.lastRejection !== null) parts.push(`Last rejection: ${s.lastRejection}.`);
  if (s.knownConditions !== null) parts.push(`Known conditions: ${s.knownConditions}.`);
  if (s.lastReport !== null) parts.push(`Last report: ${s.lastReport}`);
  return parts.length === 0 ? `${callsign} has nothing to report.` : parts.join(" ");
}
