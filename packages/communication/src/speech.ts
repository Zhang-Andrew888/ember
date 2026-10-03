/** Priority tiers, highest first: loss/stranding/retreat, withdrawal, command response, routine. */
export type SpeechTier = 1 | 2 | 3 | 4;

export interface SpeechItem {
  readonly id: string;
  readonly eventId: string;
  readonly agentId: string;
  /** The exact committed report text. Speech never paraphrases or adds to it. */
  readonly text: string;
  readonly tier: SpeechTier;
  readonly createdMs: number;
  readonly planRevision: number;
}

/** The audio device: records exactly what it was asked to say and when playback was cut. */
export interface SpeechSink {
  play(item: SpeechItem): void;
  stop(): void;
}

export class RecordingSink implements SpeechSink {
  readonly spoken: string[] = [];
  readonly stops: number[] = [];
  current: SpeechItem | null = null;
  constructor(private readonly clock: () => number = () => 0) {}
  play(item: SpeechItem): void {
    this.current = item;
    this.spoken.push(item.text);
  }
  stop(): void {
    this.current = null;
    this.stops.push(this.clock());
  }
}

export type SchedulerEvent =
  | { readonly kind: "alert"; readonly itemId: string; readonly text: string }
  | { readonly kind: "audio_preparing"; readonly itemId: string }
  | { readonly kind: "dropped"; readonly itemId: string; readonly reason: "superseded" | "duplicate" | "incident_ended" | "flushed" }
  | { readonly kind: "interrupted"; readonly itemId: string }
  | { readonly kind: "started"; readonly itemId: string }
  /** Speech synthesis or playback failed. The exact text stays in the transcript and the alert stays visible. */
  | { readonly kind: "audio_unavailable"; readonly itemId: string };

export interface SchedulerOptions {
  readonly sink: SpeechSink;
  /** Is a queued plan revision still the agent's current one? Obsolete routine speech is skipped. */
  readonly currentPlanRevision: (agentId: string) => number;
  /** Identical text from the same agent within this window is spoken once (still shown). */
  readonly coalesceMs?: number;
  readonly onEvent?: (e: SchedulerEvent) => void;
  /**
   * Wall-clock cap for one clip when no listener acknowledges it.
   * Defaults to {@link playbackAckBudgetMs}. This is not simulated time.
   */
  readonly ackBudgetMs?: (text: string) => number;
}

const MIN_PLAYBACK_ACK_MS = 30_000;
const MAX_PLAYBACK_ACK_MS = 90_000;
const ACK_MS_PER_CHAR = 120;

/**
 * How long a clip may occupy the playing slot with no browser acknowledgement.
 * The clock is wall time. Normal playback ends sooner, when the browser reports it.
 */
export function playbackAckBudgetMs(text: string): number {
  return Math.min(MAX_PLAYBACK_ACK_MS, Math.max(MIN_PLAYBACK_ACK_MS, text.length * ACK_MS_PER_CHAR));
}

const URGENT_MAX_TIER = 2;

/**
 * Audio scheduler. Urgent items interrupt routine speech; recording suspends playback and urgent
 * audio gets first priority on release; an unready higher-priority item blocks lower ones rather
 * than letting routine speech jump ahead; clearing the browser buffer is separate from any
 * provider cancellation. A clip leaves the playing slot when the listener acknowledges it,
 * when playback fails, or when its wall-clock acknowledgement budget expires.
 */
export class AudioScheduler {
  private queue: SpeechItem[] = [];
  private readonly ready = new Set<string>();
  private playing: SpeechItem | null = null;
  private recording = false;
  private ended = false;
  /** While held, ready clips stay queued instead of occupying the playing slot with nobody listening. */
  private playbackHeld = false;
  /** Bumps every time a clip begins so a replay of the same id starts a new acknowledgement budget. */
  private playingToken = 0;
  private trackedToken = 0;
  /** Wall time when the current token was first observed. Never a simTimeMs value. */
  private playingSinceMs: number | null = null;
  private readonly recent = new Map<string, number>();
  private readonly emit: (e: SchedulerEvent) => void;

  constructor(private readonly opts: SchedulerOptions) {
    this.emit = opts.onEvent ?? (() => undefined);
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get nowPlaying(): SpeechItem | null {
    return this.playing;
  }

  pending(): readonly SpeechItem[] {
    return this.queue;
  }

  static isUrgent(item: SpeechItem): boolean {
    return item.tier <= URGENT_MAX_TIER;
  }

  /** Queue a committed report. `ready` says the audio is already synthesized. */
  enqueue(item: SpeechItem, ready = true): void {
    if (this.ended) return;
    const dupKey = `${item.agentId}|${item.text}`;
    const last = this.recent.get(dupKey);
    if (last !== undefined && item.createdMs - last <= (this.opts.coalesceMs ?? 10_000)) {
      this.emit({ kind: "dropped", itemId: item.id, reason: "duplicate" });
      if (AudioScheduler.isUrgent(item)) this.emit({ kind: "alert", itemId: item.id, text: item.text });
      return;
    }
    this.recent.set(dupKey, item.createdMs);
    this.queue.push(item);
    if (ready) this.ready.add(item.id);
    if (AudioScheduler.isUrgent(item)) {
      // The alert and transcript are visible immediately, recording or not.
      this.emit({ kind: "alert", itemId: item.id, text: item.text });
      if (this.playing !== null && !AudioScheduler.isUrgent(this.playing) && !this.recording) this.interrupt();
    }
    this.pump();
  }

  /** Synthesis for a queued item finished. During recording it still waits its turn. */
  markReady(itemId: string): void {
    this.ready.add(itemId);
    this.pump();
  }

  /** Playback of the current item ended on its own. */
  finished(itemId: string): void {
    if (this.playing?.id !== itemId) return;
    this.playing = null;
    this.pump();
  }

  /**
   * The listener could not play this clip. The transcript already has the text; later clips continue.
   * A stale id (already interrupted or finished) is ignored.
   */
  playbackFailed(itemId: string): void {
    if (this.playing?.id !== itemId) return;
    this.playing = null;
    this.emit({ kind: "audio_unavailable", itemId });
    try {
      this.opts.sink.stop();
    } catch {
      // A failed device must not block the next clip.
    }
    this.pump();
  }

  /** Leave ready clips queued until {@link resumePlayback}. A clip already playing is left to the caller. */
  suspendPlayback(): void {
    this.playbackHeld = true;
  }

  /** Allow the next ready clip to start. */
  resumePlayback(): void {
    this.playbackHeld = false;
    this.pump();
  }

  /**
   * Release the playing clip if the browser has not acknowledged it within the wall-clock budget.
   * `wallMs` is elapsed wall time, never `simTimeMs`. The first call for a clip only starts the budget.
   */
  pollPlayback(wallMs: number): void {
    if (this.playbackHeld) return;
    const playing = this.playing;
    if (playing === null) {
      this.playingSinceMs = null;
      return;
    }
    if (this.trackedToken !== this.playingToken || this.playingSinceMs === null) {
      this.trackedToken = this.playingToken;
      this.playingSinceMs = wallMs;
      return;
    }
    const budget = (this.opts.ackBudgetMs ?? playbackAckBudgetMs)(playing.text);
    if (wallMs - this.playingSinceMs >= budget) {
      this.playingSinceMs = null;
      this.finished(playing.id);
    }
  }

  startRecording(): void {
    this.recording = true;
    if (this.playing !== null) {
      const stopped = this.playing;
      this.interrupt();
      // Routine content may be replayed later only if it is still relevant.
      if (!AudioScheduler.isUrgent(stopped)) this.queue.unshift(stopped);
    }
  }

  stopRecording(): void {
    this.recording = false;
    this.pump();
  }

  /** Drop every queued sample at once. Provider-side cancellation is a separate concern. */
  flush(): void {
    for (const item of this.queue) this.emit({ kind: "dropped", itemId: item.id, reason: "flushed" });
    this.queue = [];
    if (this.playing !== null) this.interrupt();
  }

  /** The incident ended: cancel stale audio and allow one concise end announcement. */
  endIncident(announcement: SpeechItem | null): void {
    for (const item of this.queue) this.emit({ kind: "dropped", itemId: item.id, reason: "incident_ended" });
    this.queue = [];
    if (this.playing !== null) this.interrupt();
    this.ended = true;
    if (announcement !== null) {
      this.ended = false;
      this.enqueue(announcement);
      this.ended = true;
    }
  }

  private interrupt(): void {
    if (this.playing === null) return;
    this.emit({ kind: "interrupted", itemId: this.playing.id });
    this.playing = null;
    this.opts.sink.stop();
  }

  private pump(): void {
    if (this.playing !== null || this.recording || this.playbackHeld) return;
    // Obsolete routine items are skipped before playback.
    this.queue = this.queue.filter((item) => {
      if (item.tier >= 3 && item.planRevision < this.opts.currentPlanRevision(item.agentId)) {
        this.emit({ kind: "dropped", itemId: item.id, reason: "superseded" });
        return false;
      }
      return true;
    });
    if (this.queue.length === 0) return;
    const order = [...this.queue].sort((a, b) => a.tier - b.tier || a.createdMs - b.createdMs);
    const head = order[0]!;
    if (!this.ready.has(head.id)) {
      // A higher-priority item that is not ready blocks everything behind it.
      this.emit({ kind: "audio_preparing", itemId: head.id });
      return;
    }
    this.queue = this.queue.filter((q) => q.id !== head.id);
    this.playing = head;
    this.playingToken += 1;
    this.emit({ kind: "started", itemId: head.id });
    try {
      this.opts.sink.play(head);
    } catch {
      // A failed speaker must never freeze the incident or block later items.
      this.playing = null;
      this.emit({ kind: "audio_unavailable", itemId: head.id });
      this.pump();
    }
  }
}
