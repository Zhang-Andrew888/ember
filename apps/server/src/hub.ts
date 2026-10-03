import { PushToTalk } from "@ember/communication";
import { dueSimTimeMs, SIM_DEFAULTS } from "@ember/simulation";
import type { ConversationBridge } from "./conversation.js";
import { decode, encode, type ServerMessage } from "./protocol.js";
import type { MonotonicClock, TechnicalFailure } from "./runner.js";
import type { IncidentSession } from "./session.js";

export type ClientId = number;

/**
 * Fan-out of sanitized server messages and intake of validated client messages. The hub never
 * advances the world; the live run does, on the monotonic clock.
 */
export class SessionHub {
  private readonly outboxes = new Map<ClientId, string[]>();
  private readonly ptt = new Map<ClientId, PushToTalk>();
  private nextClient = 1;
  private transcriptPointer = 0;
  private decisionPointer = 0;
  private eventPointer = 0;
  private endSent = false;
  private lastViewStep = -1;

  constructor(
    private readonly session: IncidentSession,
    private readonly bridge: ConversationBridge,
    private readonly viewEverySteps = 1,
  ) {}

  connect(): ClientId {
    const id = this.nextClient++;
    this.outboxes.set(id, []);
    this.ptt.set(id, new PushToTalk());
    this.send(id, { type: "view", view: this.session.incident.projectCoordinator() });
    return id;
  }

  /** A closed socket mid-capture keeps its transcript as unsent for explicit resend. */
  disconnect(id: ClientId, partialTranscript = ""): void {
    this.ptt.get(id)?.disconnect(this.session.incident.simTimeMs, partialTranscript);
    this.outboxes.delete(id);
  }

  /** A returning client keeps its capture state (including an unsent utterance) and gets a fresh view. */
  reconnect(id: ClientId): void {
    if (!this.ptt.has(id)) return;
    this.outboxes.set(id, []);
    this.send(id, { type: "view", view: this.session.incident.projectCoordinator() });
    const unsent = this.ptt.get(id)?.unsentUtterance;
    if (unsent !== null && unsent !== undefined) {
      this.send(id, { type: "notice", kind: "unsent_utterance", detail: unsent.text });
    }
  }

  drain(id: ClientId): string[] {
    const box = this.outboxes.get(id);
    if (box === undefined) return [];
    return box.splice(0, box.length);
  }

  private send(id: ClientId, message: ServerMessage): void {
    this.outboxes.get(id)?.push(encode(message));
  }

  private broadcast(message: ServerMessage): void {
    const text = encode(message);
    for (const box of this.outboxes.values()) box.push(text);
  }

  handle(id: ClientId, raw: string, wallMs: number): void {
    const msg = decode(raw);
    if (msg === null) {
      this.send(id, { type: "notice", kind: "bad_message", detail: "Message was not understood and was ignored." });
      return;
    }
    const ptt = this.ptt.get(id);
    const submit = (text: string, key: string): void => {
      for (const o of this.bridge.say(text, wallMs, key)) this.send(id, { type: "receipt", receipt: o.receipt, reply: o.reply });
    };
    switch (msg.type) {
      case "say":
        submit(msg.text, msg.idempotencyKey);
        return;
      case "ptt_begin":
        ptt?.begin(wallMs, this.bridge.gateway.activeRecipientId);
        this.bridge.scheduler.startRecording();
        return;
      case "ptt_release":
      case "ptt_lost_focus": {
        const utterance = msg.type === "ptt_release" ? ptt?.release(wallMs, msg.transcript) : ptt?.lostFocus(wallMs, msg.transcript);
        this.bridge.scheduler.stopRecording();
        if (utterance !== null && utterance !== undefined && utterance.text.trim() !== "") submit(utterance.text, `ptt-${id}-${utterance.releasedMs}`);
        return;
      }
      case "resend": {
        const u = ptt?.resend();
        if (u === null || u === undefined) return;
        submit(u.text, `resend-${id}-${u.releasedMs}`);
        return;
      }
    }
  }

  /** Publish anything new after a simulation step. Throttle the full view; events always go out. */
  afterStep(): void {
    const inc = this.session.incident;
    const stepIndex = Math.floor(inc.simTimeMs / SIM_DEFAULTS.stepMs);
    if (stepIndex !== this.lastViewStep && stepIndex % this.viewEverySteps === 0) {
      this.lastViewStep = stepIndex;
      this.broadcast({ type: "view", view: inc.projectCoordinator() });
    }
    for (; this.transcriptPointer < this.bridge.transcript.length; this.transcriptPointer++) {
      const t = this.bridge.transcript[this.transcriptPointer]!;
      this.broadcast({ type: "transcript", kind: t.kind, text: t.text, simTimeMs: t.simTimeMs, urgent: t.urgent });
    }
    for (; this.decisionPointer < this.session.decisions.length; this.decisionPointer++) {
      const d = this.session.decisions[this.decisionPointer]!;
      this.broadcast({ type: "decision", decision: d.event, callsign: d.callsign });
    }
    for (; this.eventPointer < this.bridge.events.length; this.eventPointer++) {
      const e = this.bridge.events[this.eventPointer]!;
      this.broadcast({ type: "audio", event: e.kind === "dropped" ? "dropped" : e.kind, itemId: e.itemId });
    }
    for (const n of this.bridge.gateway.takeNotices()) this.broadcast({ type: "notice", kind: n.kind, detail: n.commandId });
    if (inc.ended && !this.endSent && inc.end !== null) {
      this.endSent = true;
      this.broadcast({ type: "view", view: inc.projectCoordinator() });
      this.broadcast({ type: "ended", end: inc.end });
    }
  }
}

/**
 * The live loop: advance the incident only to the simulated time due on a monotonic clock, step
 * controllers each simulated second, and publish. Falling behind is reported, never hidden by
 * slowing the incident.
 */
export class LiveRun {
  readonly failures: TechnicalFailure[] = [];
  private startedAt: number | null = null;

  constructor(
    readonly session: IncidentSession,
    readonly bridge: ConversationBridge,
    readonly hub: SessionHub,
    private readonly clock: MonotonicClock,
    private readonly backlogThresholdSimMs = 5000,
  ) {}

  get wallElapsedMs(): number {
    return this.startedAt === null ? 0 : Math.max(0, Math.floor(this.clock.nowMs() - this.startedAt));
  }

  start(): void {
    if (this.startedAt === null) this.startedAt = this.clock.nowMs();
  }

  pump(): void {
    this.start();
    const inc = this.session.incident;
    const wall = this.wallElapsedMs;
    inc.setWallElapsed(wall);
    const due = dueSimTimeMs(wall);
    if (!inc.ended && due - inc.simTimeMs > this.backlogThresholdSimMs) {
      this.failures.push({ kind: "processing_backlog", atWallMs: wall, backlogSimMs: due - inc.simTimeMs });
    }
    while (!inc.ended && inc.simTimeMs + SIM_DEFAULTS.stepMs <= due) {
      this.session.step();
      this.bridge.collect();
      this.hub.afterStep();
    }
    for (const o of this.bridge.pollWall(wall)) void o;
    this.hub.afterStep();
  }
}
