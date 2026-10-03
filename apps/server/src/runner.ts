import type { DomainEvent } from "@ember/domain";
import type {
  Incident} from "@ember/simulation";
import {
  dueSimTimeMs,
  type InputReceipt,
  type SimInput,
} from "@ember/simulation";

/** A monotonic millisecond reading. Wall time never feeds fire progression directly. */
export interface MonotonicClock {
  nowMs(): number;
}

export interface TechnicalFailure {
  readonly kind: "processing_backlog";
  readonly atWallMs: number;
  readonly backlogSimMs: number;
}

export interface RunnerOptions {
  /** Backlog (simulated ms behind due time) above which a technical failure is recorded. */
  readonly backlogThresholdSimMs?: number;
}

const DEFAULT_BACKLOG_THRESHOLD_MS = 5000;

/**
 * Drives an Incident from a monotonic clock. The world only ever advances to
 * dueSimTimeMs(wallElapsed); rendering cadence, provider latency and pump frequency change
 * when steps run, never what they compute. Falling behind is reported, not hidden by
 * slowing the incident.
 */
export class IncidentRunner {
  readonly failures: TechnicalFailure[] = [];
  private startedAtMs: number | null = null;
  private readonly threshold: number;

  constructor(
    readonly incident: Incident,
    private readonly clock: MonotonicClock,
    options: RunnerOptions = {},
  ) {
    this.threshold = options.backlogThresholdSimMs ?? DEFAULT_BACKLOG_THRESHOLD_MS;
  }

  start(): void {
    if (this.startedAtMs === null) this.startedAtMs = this.clock.nowMs();
  }

  get wallElapsedMs(): number {
    if (this.startedAtMs === null) return 0;
    return Math.max(0, Math.floor(this.clock.nowMs() - this.startedAtMs));
  }

  /** Advance the incident to the simulated time that is due now. */
  pump(): DomainEvent[] {
    this.start();
    const wall = this.wallElapsedMs;
    this.incident.setWallElapsed(wall);
    const due = dueSimTimeMs(wall);
    const behind = due - this.incident.simTimeMs;
    if (!this.incident.ended && behind > this.threshold) {
      this.failures.push({ kind: "processing_backlog", atWallMs: wall, backlogSimMs: behind });
    }
    return this.incident.advanceTo(due);
  }

  /**
   * Accept an input at the current wall time. The world is first brought to the due tick,
   * so the input is applied at the same simulated tick regardless of how often pump ran.
   */
  receive(input: SimInput): InputReceipt {
    this.pump();
    return this.incident.submit(input);
  }
}
