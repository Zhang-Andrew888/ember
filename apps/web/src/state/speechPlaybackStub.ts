/**
 * Exact-text speech-playback stub (backlog item 4 / feat/web-ui). Models pending ->
 * playing -> idle, urgent preemption, and a single-slot routine queue after urgent
 * playback (docs/COMMUNICATION.md). Urgent audio can be deferred while push-to-talk
 * recording is active (docs/FRONTEND.md: recording preserved during urgent reports).
 */

export type SpeechPlaybackState = "idle" | "pending" | "playing";

export interface SpeechPlaybackSnapshot {
  readonly state: SpeechPlaybackState;
  readonly text: string | null;
  readonly urgent: boolean;
  /** True when urgent audio is waiting for recording to finish or for the current clip. */
  readonly queuedUrgent: boolean;
  readonly queuedRoutineCount: number;
}

export interface SpeechPlaybackStub {
  getSnapshot(): SpeechPlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  speak(text: string, options?: { urgent?: boolean }): void;
  setRecording(active: boolean): void;
  cancel(): void;
  dispose(): void;
}

const IDLE_SNAPSHOT: SpeechPlaybackSnapshot = {
  state: "idle",
  text: null,
  urgent: false,
  queuedUrgent: false,
  queuedRoutineCount: 0,
};

const PENDING_MS = 200;
const MIN_PLAYING_MS = 1200;
const MAX_PLAYING_MS = 4000;
const MS_PER_WORD = 220;

function playingDurationFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(MAX_PLAYING_MS, Math.max(MIN_PLAYING_MS, words * MS_PER_WORD));
}

interface QueuedUtterance {
  readonly text: string;
  readonly urgent: boolean;
}

export function createSpeechPlaybackStub(): SpeechPlaybackStub {
  const listeners = new Set<() => void>();
  let snapshot: SpeechPlaybackSnapshot = IDLE_SNAPSHOT;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let playingTimer: ReturnType<typeof setTimeout> | null = null;
  let recording = false;
  let deferredUrgent: QueuedUtterance | null = null;
  const routineQueue: QueuedUtterance[] = [];

  function clearTimers(): void {
    if (pendingTimer) clearTimeout(pendingTimer);
    if (playingTimer) clearTimeout(playingTimer);
    pendingTimer = null;
    playingTimer = null;
  }

  function queueSnapshot(): Pick<SpeechPlaybackSnapshot, "queuedUrgent" | "queuedRoutineCount"> {
    return {
      queuedUrgent: deferredUrgent !== null,
      queuedRoutineCount: routineQueue.length,
    };
  }

  function setSnapshot(next: SpeechPlaybackSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function startUtterance(text: string, urgent: boolean): void {
    clearTimers();
    setSnapshot({ state: "pending", text, urgent, ...queueSnapshot() });

    pendingTimer = setTimeout(() => {
      setSnapshot({ state: "playing", text, urgent, ...queueSnapshot() });
      playingTimer = setTimeout(() => {
        finishCurrent();
      }, playingDurationFor(text));
    }, PENDING_MS);
  }

  function finishCurrent(): void {
    clearTimers();
    if (deferredUrgent !== null && !recording) {
      const next = deferredUrgent;
      deferredUrgent = null;
      startUtterance(next.text, true);
      return;
    }
    const routine = routineQueue.shift();
    if (routine !== undefined) {
      startUtterance(routine.text, false);
      return;
    }
    setSnapshot(IDLE_SNAPSHOT);
  }

  function enqueue(utterance: QueuedUtterance): void {
    if (utterance.urgent) {
      if (recording) {
        deferredUrgent = utterance;
        setSnapshot({ ...snapshot, ...queueSnapshot() });
        return;
      }
      if (snapshot.state !== "idle") {
        clearTimers();
        deferredUrgent = null;
        routineQueue.length = 0;
        startUtterance(utterance.text, true);
        return;
      }
      startUtterance(utterance.text, true);
      return;
    }

    if (snapshot.state === "idle" && deferredUrgent === null) {
      startUtterance(utterance.text, false);
      return;
    }
    routineQueue.push(utterance);
    setSnapshot({ ...snapshot, ...queueSnapshot() });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    speak: (text, options = {}) => {
      enqueue({ text, urgent: options.urgent ?? false });
    },
    setRecording: (active) => {
      recording = active;
      if (!recording && deferredUrgent !== null && snapshot.state === "idle") {
        const next = deferredUrgent;
        deferredUrgent = null;
        startUtterance(next.text, true);
      } else {
        setSnapshot({ ...snapshot, ...queueSnapshot() });
      }
    },
    cancel: () => {
      clearTimers();
      deferredUrgent = null;
      routineQueue.length = 0;
      setSnapshot(IDLE_SNAPSHOT);
    },
    dispose: () => {
      clearTimers();
      deferredUrgent = null;
      routineQueue.length = 0;
      listeners.clear();
    },
  };
}
