import { PushToTalk, type Utterance } from "@ember/communication";
import { dueSimTimeMs, SIM_DEFAULTS } from "@ember/simulation";
import type { ConversationBridge } from "./conversation.js";
import { decode, encodeServer, type ServerMessage } from "./protocol.js";
import type { MonotonicClock, TechnicalFailure } from "./runner.js";
import type { CoordinatorView } from "@ember/domain";
import type { IncidentSession } from "./session.js";
import type { ViewRecorder } from "./view-recorder.js";

export type ClientId = number;

/**
 * Fan-out of sanitized server messages and intake of validated client messages. The hub never
 * advances the world; the live run does, on the monotonic clock.
 */
/** Slow clients must reconnect after overflow; a reading client drains every flush (~200 ms). */
const MAX_OUTBOX_MESSAGES = 4096;

export const TECHNICAL_FAILURE_DETAIL = "A technical problem occurred on the server.";

export class SessionHub {
  private readonly outboxes = new Map<ClientId, string[]>();
  /** Clients dropped because their outbound queue overflowed (backpressure). */
  readonly backpressureClosed = new Set<ClientId>();
  private readonly ptt = new Map<ClientId, PushToTalk>();
  /** Clients with an open capture. Playback stays suspended until the last one ends. */
  private readonly recordingClients = new Set<ClientId>();
  private nextClient = 1;
  private transcriptPointer = 0;
  private decisionPointer = 0;
  private eventPointer = 0;
  private endSent = false;
  private lastViewStep = -1;

  constructor(
    private readonly session: IncidentSession,
    private readonly bridge: ConversationBridge,
    private readonly viewRecorder: ViewRecorder,
    private readonly viewEverySteps = 1,
  ) {}

  private emitView(view: CoordinatorView, clientId?: ClientId): void {
    this.viewRecorder.record(view, this.session.incident.eventCount);
    if (clientId !== undefined) this.send(clientId, { type: "view", view });
    else this.broadcast({ type: "view", view });
  }

  connect(): ClientId {
    const id = this.nextClient++;
    this.outboxes.set(id, []);
    this.ptt.set(id, new PushToTalk());
    this.emitView(this.session.coordinatorView(), id);
    return id;
  }

  /**
   * Release a closed socket. A partial utterance is finished as unsent and then dropped with the
   * rest of that client's capture state — production reconnects allocate a new id, so retaining
   * it would keep every closed client for the life of the incident. Nothing is submitted.
   */
  disconnect(id: ClientId, wallMs: number, partialTranscript = ""): void {
    const capture = this.ptt.get(id);
    const wasRecording = capture?.state === "recording";
    capture?.disconnect(wallMs, partialTranscript);
    this.ptt.delete(id);
    if (wasRecording) this.noteCaptureEnded(id);
    this.outboxes.delete(id);
    this.backpressureClosed.delete(id);
  }

  /** Per-client records still held. Closed sockets must not remain in any of these. */
  retainedClients(): { capture: number; outboxes: number; backpressure: number } {
    return {
      capture: this.ptt.size,
      outboxes: this.outboxes.size,
      backpressure: this.backpressureClosed.size,
    };
  }

  /** A client that still has capture state gets a fresh view. A disconnected id has none. */
  reconnect(id: ClientId): void {
    if (!this.ptt.has(id)) return;
    this.outboxes.set(id, []);
    this.emitView(this.session.coordinatorView(), id);
    const unsent = this.ptt.get(id)?.unsentUtterance;
    if (unsent !== null && unsent !== undefined) {
      this.send(id, { type: "notice", kind: "unsent_utterance", detail: unsent.text });
    }
  }

  /** Half-submitted utterance for a client that still has capture state; null after release. */
  unsentUtterance(id: ClientId): Utterance | null {
    return this.ptt.get(id)?.unsentUtterance ?? null;
  }

  drain(id: ClientId): string[] {
    const box = this.outboxes.get(id);
    if (box === undefined) return [];
    return box.splice(0, box.length);
  }

  private send(id: ClientId, message: ServerMessage): boolean {
    const box = this.outboxes.get(id);
    if (box === undefined) return false;
    if (box.length >= MAX_OUTBOX_MESSAGES) {
      this.backpressureClosed.add(id);
      this.outboxes.delete(id);
      return false;
    }
    box.push(encodeServer(message));
    return true;
  }

  private broadcast(message: ServerMessage): void {
    for (const id of [...this.outboxes.keys()]) this.send(id, message);
  }

  private noteCaptureBegan(id: ClientId): void {
    const first = this.recordingClients.size === 0;
    this.recordingClients.add(id);
    if (first) this.bridge.scheduler.startRecording();
  }

  private noteCaptureEnded(id: ClientId): void {
    if (!this.recordingClients.delete(id)) return;
    if (this.recordingClients.size === 0) this.bridge.scheduler.stopRecording();
  }

  /** Fixed-text notice: error details stay in the server log, never on the wire. */
  notifyTechnicalFailure(): void {
    this.broadcast({ type: "notice", kind: "technical_failure", detail: TECHNICAL_FAILURE_DETAIL });
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
        if (ptt?.begin(wallMs, this.bridge.gateway.activeRecipientId) === true) this.noteCaptureBegan(id);
        return;
      case "ptt_release":
      case "ptt_lost_focus": {
        const utterance = msg.type === "ptt_release" ? ptt?.release(wallMs, msg.transcript) : ptt?.lostFocus(wallMs, msg.transcript);
        // A release with no matching begin is not a capture; it must not resume anyone else's audio.
        if (utterance === null || utterance === undefined) return;
        this.noteCaptureEnded(id);
        if (utterance.text.trim() !== "") submit(utterance.text, `ptt-${id}-${utterance.releasedMs}`);
        return;
      }
      case "inspect": {
        // Only what the coordinator already sees; the active recipient is reported, never changed.
        const view = this.session.coordinatorView();
        const agent = view.agents.find((a) => a.id === msg.agentId);
        if (agent === undefined) {
          this.send(id, { type: "notice", kind: "bad_message", detail: "Unknown agent." });
          return;
        }
        this.send(id, { type: "inspection", agentId: agent.id, callsign: agent.callsign, state: agent.state, activeRecipientId: view.activeRecipientId });
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
      this.emitView(this.session.coordinatorView());
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
      this.emitView(this.session.coordinatorView());
      this.broadcast({ type: "ended", end: inc.end });
    }
  }
}

/** Wall time an ended incident keeps being pumped so its closing audio and events can drain. */
export const ENDED_PUMP_GRACE_MS = 60_000;

/**
 * The live loop: advance the incident only to the simulated time due on a monotonic clock, step
 * controllers each simulated second, and publish. Falling behind is reported, never hidden by
 * slowing the incident.
 */
export class LiveRun {
  readonly failures: TechnicalFailure[] = [];
  private startedAt: number | null = null;
  private halted = false;
  private endedAtWallMs: number | null = null;

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

  /** True once a pump threw; the incident is frozen and clients were told once. */
  get isHalted(): boolean {
    return this.halted;
  }

  /**
   * Pump that never throws. The world is only advanced by `pump`, so after an exception its state
   * can't be trusted: stop pumping this incident, tell clients once, and keep serving the process.
   */
  safePump(): void {
    if (this.halted) return;
    if (this.session.incident.ended) {
      // Keep pumping for a short grace period so the end announcement and audio events drain, then stop:
      // an ended incident has nothing left to advance, and every 200 ms tick per old incident adds up.
      const now = this.wallElapsedMs;
      this.endedAtWallMs ??= now;
      if (now - this.endedAtWallMs > ENDED_PUMP_GRACE_MS) return;
    }
    try {
      this.pump();
    } catch (error) {
      this.halted = true;
      this.failures.push({ kind: "internal_error", atWallMs: this.wallElapsedMs });
      process.stderr.write(`ember-server: incident pump failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      try {
        this.hub.notifyTechnicalFailure();
      } catch {
        // Notifying is best effort; the halt above already protects the process.
      }
    }
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
