import { SimTimeMs } from "@ember/domain";
import type { AgentId, EndReason } from "@ember/domain";
import type { SimScenario } from "@ember/simulation";
import {
  AudioScheduler,
  CommandGateway,
  RecordingSink,
  ScriptedInterpreter,
  createGrokInterpreter,
  lossNarration,
  type IntentEnvelope,
  replyForDecision,
  type Directory,
  type GatewayOutcome,
  type Interpreter,
  type Phrasing,
  type Report,
  type SchedulerEvent,
} from "@ember/communication";
import type { IncidentSession } from "./session.js";
import type { SpeechAudioStore } from "./xai/speech-audio-store.js";
import { completeIntentInterpretation } from "./xai/chat.js";
import { grokIntentEnabled } from "./xai/env.js";
import { synthesizeSpeech } from "./xai/tts.js";
import type { SpeechItem, SpeechTier } from "@ember/communication";

/** Spoken/transcript sentence per end reason (the web debrief uses the same wording). */
const END_REASON_SENTENCE: Record<EndReason, string> = {
  all_protection_crews_lost: "All protection crews were lost.",
  all_sites_resolved: "All sites were resolved.",
  fire_extinguished: "The fire was extinguished.",
  time_expired: "The incident window expired.",
};

const POINT_NAMES: Record<string, string> = { "n-n": "north road", "n-s": "south junction", "n-h": "hub" };

/** Public names for the synthetic scenario; a real extract would ship its own authored names. */
export function directoryFor(scenario: SimScenario): Directory {
  const nodes = new Map(scenario.map.nodes.map((n) => [n.id as string, n]));
  const point = (id: string): { x: number; y: number } => nodes.get(id) ?? { x: 0, y: 0 };
  const corridor = scenario.map.edges.find((e) => e.singleCapacity);
  const a = corridor === undefined ? null : point(corridor.from);
  const b = corridor === undefined ? null : point(corridor.to);
  return {
    agents: scenario.agents.map((x) => ({ id: x.id, callsign: x.callsign, role: x.role })),
    sites: scenario.map.sites.map((s) => ({ id: s.id, name: s.name })),
    scoutPoints: scenario.map.scoutPoints.map((p) => ({ id: p, name: POINT_NAMES[p] ?? p })),
    locations: [
      ...scenario.map.scoutPoints.map((p) => ({ name: POINT_NAMES[p] ?? p, ...point(p), radius: 150 })),
      ...(a !== null && b !== null ? [{ name: "east corridor", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, radius: 250 }] : []),
    ],
    corridors:
      corridor === undefined
        ? []
        : [{ id: corridor.id as string, name: "east corridor" }],
  };
}

export interface TranscriptEntry {
  readonly kind: "coordinator" | "control" | "agent" | "system";
  readonly text: string;
  readonly simTimeMs: number;
  readonly urgent: boolean;
}

export interface BridgeOptions {
  readonly interpreter?: Interpreter;
  readonly phrasing?: Phrasing;
  /** When set with `grokTts`, outgoing speech is synthesized before playback is marked ready. */
  readonly speechStore?: SpeechAudioStore;
  readonly grokTts?: boolean;
  /** Wall-clock cap for one clip when the browser never acknowledges it. Not simulated time. */
  readonly playbackAckBudgetMs?: (text: string) => number;
}

/**
 * Conversation layer over a session: the gateway validates coordinator messages, applies their
 * actions to the session, and every spoken line is built from a committed decision or receipt.
 * With no provider attached it uses the scripted interpreter and a recording speech sink.
 */
export class ConversationBridge {
  readonly gateway: CommandGateway;
  readonly scheduler: AudioScheduler;
  readonly sink = new RecordingSink();
  readonly transcript: TranscriptEntry[] = [];
  readonly events: SchedulerEvent[] = [];
  private decisionPointer = 0;
  private noticePointer = 0;
  private endAnnounced = false;
  private speechSeq = 0;
  private readonly phrasing: Phrasing;
  private readonly speechStore: SpeechAudioStore | undefined;
  private readonly grokTts: boolean;
  /** Browsers currently connected that can play and acknowledge speech. */
  private speechAudience = 0;

  constructor(
    private readonly session: IncidentSession,
    options: BridgeOptions = {},
  ) {
    this.phrasing = options.phrasing ?? "plain";
    this.speechStore = options.speechStore;
    this.grokTts = options.grokTts ?? false;
    const inc = session.incident;
    const asyncDeliver: { fn?: (seq: number, env: IntentEnvelope) => void } = {};
    const interpreter =
      options.interpreter ??
      (grokIntentEnabled()
        ? createGrokInterpreter(completeIntentInterpretation, (seq, env) => asyncDeliver.fn?.(seq, env))
        : new ScriptedInterpreter());
    this.gateway = new CommandGateway({
      directory: directoryFor(inc.scenario),
      interpreter,
      picture: () => this.picture(),
      status: (id) => {
        const c = session.controllers.get(id as AgentId);
        return c === undefined ? null : c.status(inc.projectAgent(id as AgentId));
      },
      nowSimMs: () => inc.simTimeMs,
      incidentEnded: () => inc.ended,
    });
    asyncDeliver.fn = (seq, env) => this.applyOutcomes(this.gateway.deliver(seq, env));
    this.scheduler = new AudioScheduler({
      sink: this.sink,
      currentPlanRevision: (agent) => (inc.scenario.agents.some((a) => a.id === agent) ? inc.projectAgent(agent as AgentId).planRevision : 0),
      onEvent: (e) => this.events.push(e),
      ...(options.playbackAckBudgetMs === undefined ? {} : { ackBudgetMs: options.playbackAckBudgetMs }),
    });
    // Prepared clips wait for a browser. Otherwise the first line occupies the playing slot forever.
    if (this.grokTts) this.scheduler.suspendPlayback();
  }

  /**
   * The browser finished or failed a clip. Either way the playing slot clears so the next line can start.
   * A report for a clip that is no longer current is ignored.
   */
  acknowledgePlayback(itemId: string, outcome: "ended" | "failed"): void {
    if (outcome === "failed") this.scheduler.playbackFailed(itemId);
    else this.scheduler.finished(itemId);
  }

  /**
   * How many sockets can hear speech right now. With Grok playback, the last listener leaving releases
   * the current clip and holds the rest until someone reconnects, so the queue cannot stall.
   */
  setSpeechAudience(count: number): void {
    if (!this.grokTts) return;
    const previous = this.speechAudience;
    this.speechAudience = count;
    if (count === 0) {
      if (previous > 0) {
        this.scheduler.suspendPlayback();
        const playing = this.scheduler.nowPlaying;
        if (playing !== null) this.scheduler.finished(playing.id);
      }
      return;
    }
    if (previous === 0) this.scheduler.resumePlayback();
  }

  /** What the coordinator has actually received: sensor observations that show fire. */
  private picture(): Report[] {
    const out: Report[] = [];
    for (const o of this.session.incident.coordinator.observations()) {
      if (o.sourceAgentId === "briefing") continue;
      if (!o.observedFields.some((f) => f.kind === "cell" && f.burnState !== "unburned")) continue;
      out.push({
        id: o.id,
        kind: "sensor_observation",
        sourceAgentId: o.sourceAgentId,
        timeMs: o.observedAt,
        text: `fire observed near (${Math.round(o.spatialFootprint.centerX)}, ${Math.round(o.spatialFootprint.centerY)})`,
        footprint: { x: o.spatialFootprint.centerX, y: o.spatialFootprint.centerY, radius: o.spatialFootprint.radius },
      });
    }
    return out;
  }

  /** A coordinator message (typed, or a committed push-to-talk transcript). */
  say(text: string, wallMs: number, idempotencyKey?: string): GatewayOutcome[] {
    const inc = this.session.incident;
    this.transcript.push({ kind: "coordinator", text, simTimeMs: inc.simTimeMs, urgent: false });
    const n = this.transcript.length;
    const ticket = this.gateway.submit({ commandId: `cmd-${n}`, text, idempotencyKey: idempotencyKey ?? `key-${n}`, wallMs });
    for (const o of ticket.outcomes) this.apply(o, ticket.duplicate);
    return [...ticket.outcomes];
  }

  /** Advance provider timeouts and the speech acknowledgement budget in wall time. */
  pollWall(wallMs: number): GatewayOutcome[] {
    this.scheduler.pollPlayback(wallMs);
    const outs = this.gateway.poll(wallMs);
    for (const o of outs) this.apply(o, false);
    return outs;
  }

  /** Apply an outcome that arrived later than submit (a delayed provider answer). */
  applyOutcomes(outcomes: readonly GatewayOutcome[]): void {
    for (const o of outcomes) this.apply(o, false);
  }

  private apply(o: GatewayOutcome, duplicate: boolean): void {
    const inc = this.session.incident;
    this.transcript.push({ kind: "control", text: o.reply, simTimeMs: inc.simTimeMs, urgent: false });
    if (duplicate) return;
    for (const a of o.actions) {
      switch (a.kind) {
        case "set_recipient":
          inc.submit({ kind: "set_active_recipient", recipientId: a.recipientId });
          break;
        case "relay":
          this.session.relay(a.observationId, a.toAgentId);
          break;
        case "objective":
          this.session.sendObjective(a.objective);
          break;
        case "resume_autonomous":
          this.session.controllers.get(a.agentId)?.resumeAutonomous();
          break;
      }
    }
  }

  /** Call after each session step: turn newly committed decisions, losses and the end into speech. */
  collect(): void {
    const inc = this.session.incident;
    const now = inc.simTimeMs;
    for (; this.decisionPointer < this.session.decisions.length; this.decisionPointer++) {
      const { event, callsign } = this.session.decisions[this.decisionPointer]!;
      const reply = replyForDecision(callsign, event, this.phrasing);
      const urgent = reply.tier <= 2;
      this.transcript.push({ kind: "agent", text: reply.text, simTimeMs: now, urgent });
      this.enqueueSpeech({
        id: `sp-${this.speechSeq++}`,
        eventId: `decision-${event.agentId}-${event.sequence}`,
        agentId: event.agentId,
        text: reply.text,
        tier: reply.tier,
        createdMs: now,
        planRevision: inc.projectAgent(event.agentId).planRevision,
      });
    }
    const notices = inc.notices;
    for (; this.noticePointer < notices.length; this.noticePointer++) {
      const n = notices[this.noticePointer]!;
      if (n.kind !== "agent_lost") continue;
      const callsign = inc.scenario.agents.find((a) => a.id === n.agentId)?.callsign ?? n.agentId;
      const reply = lossNarration(callsign);
      this.transcript.push({ kind: "control", text: reply.text, simTimeMs: now, urgent: true });
      this.enqueueSpeech({
        id: `sp-${this.speechSeq++}`,
        eventId: `loss-${n.agentId}`,
        agentId: "control",
        text: reply.text,
        tier: reply.tier,
        createdMs: now,
        planRevision: 0,
      });
    }
    if (inc.ended && !this.endAnnounced) {
      this.endAnnounced = true;
      for (const o of this.gateway.endIncident()) this.apply(o, false);
      const text = `The incident has ended. ${END_REASON_SENTENCE[inc.end?.displayReason ?? "time_expired"]}`;
      this.transcript.push({ kind: "system", text, simTimeMs: now, urgent: false });
      const endItem = {
        id: `sp-${this.speechSeq++}`,
        eventId: "incident-end",
        agentId: "control",
        text,
        tier: 3 as SpeechTier,
        createdMs: SimTimeMs.parse(now),
        planRevision: 0,
      };
      this.finishEndSpeech(endItem);
    }
  }

  private finishEndSpeech(item: SpeechItem): void {
    if (!this.grokTts || this.speechStore === undefined) {
      this.scheduler.endIncident(item);
      return;
    }
    void synthesizeSpeech({ text: item.text })
      .then((bytes) => {
        this.speechStore!.put(item.id, bytes);
        this.scheduler.endIncident(item);
      })
      .catch(() => {
        this.scheduler.endIncident(item);
      });
  }

  private enqueueSpeech(item: SpeechItem): void {
    const deferReady = this.grokTts && this.speechStore !== undefined;
    this.scheduler.enqueue(item, !deferReady);
    if (!deferReady || this.speechStore === undefined) return;
    void synthesizeSpeech({ text: item.text })
      .then((bytes) => {
        this.speechStore!.put(item.id, bytes);
        this.scheduler.markReady(item.id);
      })
      .catch(() => {
        this.scheduler.markReady(item.id);
      });
  }
}
