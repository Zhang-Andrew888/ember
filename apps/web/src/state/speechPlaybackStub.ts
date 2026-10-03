/**
 * Exact-text speech-playback stub (backlog item 4). Real Grok Voice TTS is
 * Slice 5/out of scope here (and unreachable from a sandbox with no audio
 * device); this models the pending -> playing -> idle lifecycle docs/
 * COMMUNICATION.md describes ("exact-text speech", "urgent audio ...
 * first priority") so UrgentStrip's audioState prop and an outgoing-
 * message acknowledgement have something real driving them, without
 * fabricating actual synthesized audio.
 *
 * Simplification, stated plainly rather than silently: this stub has no
 * queue. An urgent speak() always interrupts whatever is playing
 * (docs/COMMUNICATION.md: "An urgent report interrupts routine playback").
 * A routine speak() while something is already active is dropped, not
 * queued - a real implementation would likely queue or summarize it
 * (docs: "Routine report becomes obsolete before playback: skip or
 * summarize current state"); this stub always takes the "skip" option
 * rather than building a queue backlog item 4 doesn't ask for.
 */

export type SpeechPlaybackState = "idle" | "pending" | "playing";

export interface SpeechPlaybackSnapshot {
  readonly state: SpeechPlaybackState;
  readonly text: string | null;
  readonly urgent: boolean;
}

export interface SpeechPlaybackStub {
  getSnapshot(): SpeechPlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  speak(text: string, options?: { urgent?: boolean }): void;
  /** Drops whatever is pending/playing and returns to idle, without removing subscribers (see dispose() for that). */
  cancel(): void;
  dispose(): void;
}

const IDLE_SNAPSHOT: SpeechPlaybackSnapshot = { state: "idle", text: null, urgent: false };

const PENDING_MS = 200;
const MIN_PLAYING_MS = 1200;
const MAX_PLAYING_MS = 4000;
const MS_PER_WORD = 220;

function playingDurationFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(MAX_PLAYING_MS, Math.max(MIN_PLAYING_MS, words * MS_PER_WORD));
}

export function createSpeechPlaybackStub(): SpeechPlaybackStub {
  const listeners = new Set<() => void>();
  let snapshot: SpeechPlaybackSnapshot = IDLE_SNAPSHOT;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let playingTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (pendingTimer) clearTimeout(pendingTimer);
    if (playingTimer) clearTimeout(playingTimer);
    pendingTimer = null;
    playingTimer = null;
  }

  function setSnapshot(next: SpeechPlaybackSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    speak: (text, options = {}) => {
      const urgent = options.urgent ?? false;
      if (snapshot.state !== "idle" && !urgent) return; // routine never jumps the queue

      clearTimers();
      setSnapshot({ state: "pending", text, urgent });

      pendingTimer = setTimeout(() => {
        setSnapshot({ state: "playing", text, urgent });
        playingTimer = setTimeout(() => {
          setSnapshot(IDLE_SNAPSHOT);
        }, playingDurationFor(text));
      }, PENDING_MS);
    },
    cancel: () => {
      clearTimers();
      setSnapshot(IDLE_SNAPSHOT);
    },
    dispose: () => {
      clearTimers();
      listeners.clear();
    },
  };
}
