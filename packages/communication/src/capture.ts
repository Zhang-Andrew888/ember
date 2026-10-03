export type CaptureState = "idle" | "recording" | "committed" | "unsent";

export interface Utterance {
  readonly text: string;
  readonly capturedRecipientId: string | null;
  readonly startedMs: number;
  readonly releasedMs: number;
}

/**
 * Push-to-talk lifecycle: captures the active-recipient context on key-down, commits the complete
 * input exactly once on release, finishes cleanly on lost focus, and keeps a disconnected,
 * half-submitted utterance as unsent for explicit resend (never silently executing half of it).
 */
export class PushToTalk {
  private current: { capturedRecipientId: string | null; startedMs: number } | null = null;
  private unsent: Utterance | null = null;
  private lastState: CaptureState = "idle";

  get state(): CaptureState {
    return this.current !== null ? "recording" : this.lastState;
  }

  begin(nowMs: number, activeRecipientId: string | null): boolean {
    if (this.current !== null) return false;
    this.current = { capturedRecipientId: activeRecipientId, startedMs: nowMs };
    this.lastState = "recording";
    return true;
  }

  /** Release commits once. A second release (or lost focus after release) returns null. */
  release(nowMs: number, transcript: string): Utterance | null {
    if (this.current === null) return null;
    const u: Utterance = {
      text: transcript,
      capturedRecipientId: this.current.capturedRecipientId,
      startedMs: this.current.startedMs,
      releasedMs: nowMs,
    };
    this.current = null;
    this.lastState = "committed";
    return u;
  }

  /** Lost focus or pointer cancel finishes capture with whatever transcript exists. */
  lostFocus(nowMs: number, transcript: string): Utterance | null {
    return this.release(nowMs, transcript);
  }

  /** The connection dropped before the complete submission: retain the transcript as unsent. */
  disconnect(nowMs: number, transcript: string): void {
    if (this.current === null) return;
    this.unsent = {
      text: transcript,
      capturedRecipientId: this.current.capturedRecipientId,
      startedMs: this.current.startedMs,
      releasedMs: nowMs,
    };
    this.current = null;
    this.lastState = "unsent";
  }

  /** Explicit resend of an unsent utterance. */
  resend(): Utterance | null {
    const u = this.unsent;
    this.unsent = null;
    if (u !== null) this.lastState = "committed";
    return u;
  }

  get unsentUtterance(): Utterance | null {
    return this.unsent;
  }
}
