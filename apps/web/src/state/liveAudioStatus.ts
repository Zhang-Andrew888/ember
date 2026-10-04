import type { WireAudioCue } from "../net/serverWireParse.js";
import type { PreparedSpeechOutcome } from "../net/grokSpeechPlayback.js";
import type { SpeechPlaybackSnapshot } from "./speechPlaybackStub.js";

/**
 * Audio state for server-prepared speech, built from the server's audio cues and this browser's
 * own playback results. Nothing here is simulated: an item is "playing" only once the browser has
 * started it.
 */
export interface LiveAudioStatus {
  readonly state: "idle" | "pending" | "playing";
  readonly currentItemId: string | null;
  readonly urgent: boolean;
  /** Urgent items announced by `alert` that have not started or been dropped yet. */
  readonly queuedUrgentIds: readonly string[];
  /** Latest audio problem; the words are always in the conversation regardless. */
  readonly notice: string | null;
}

export type LiveAudioEvent =
  | { readonly kind: "cue"; readonly cue: Pick<WireAudioCue, "event" | "itemId"> }
  | { readonly kind: "playing"; readonly itemId: string }
  | { readonly kind: "outcome"; readonly itemId: string; readonly outcome: PreparedSpeechOutcome }
  | { readonly kind: "stop" }
  | { readonly kind: "dismiss_notice" };

export const INITIAL_LIVE_AUDIO: LiveAudioStatus = {
  state: "idle",
  currentItemId: null,
  urgent: false,
  queuedUrgentIds: [],
  notice: null,
};

export const AUDIO_UNAVAILABLE_NOTICE = "Spoken audio is unavailable for a message. Read it in the conversation.";
export const AUDIO_PLAYBACK_FAILED_NOTICE = "Audio playback failed in this browser. Messages remain in the conversation.";

function without(ids: readonly string[], itemId: string): readonly string[] {
  return ids.includes(itemId) ? ids.filter((id) => id !== itemId) : ids;
}

function settle(status: LiveAudioStatus, itemId: string, notice: string | null): LiveAudioStatus {
  const queuedUrgentIds = without(status.queuedUrgentIds, itemId);
  const base = { ...status, queuedUrgentIds, notice: notice ?? status.notice };
  if (status.currentItemId !== itemId) return base;
  return { ...base, state: "idle", currentItemId: null, urgent: false };
}

export function liveAudioReducer(status: LiveAudioStatus, event: LiveAudioEvent): LiveAudioStatus {
  switch (event.kind) {
    case "cue": {
      const { event: cue, itemId } = event.cue;
      switch (cue) {
        case "alert":
          return status.queuedUrgentIds.includes(itemId)
            ? status
            : { ...status, queuedUrgentIds: [...status.queuedUrgentIds, itemId] };
        case "audio_preparing":
        case "started":
          return {
            ...status,
            state: status.currentItemId === itemId && status.state === "playing" ? "playing" : "pending",
            currentItemId: itemId,
            urgent: status.queuedUrgentIds.includes(itemId),
          };
        case "audio_unavailable":
          return settle(status, itemId, AUDIO_UNAVAILABLE_NOTICE);
        case "interrupted":
        case "dropped":
          return settle(status, itemId, null);
      }
      return status;
    }
    case "playing":
      return {
        ...status,
        state: "playing",
        currentItemId: event.itemId,
        urgent: status.queuedUrgentIds.includes(event.itemId) || (status.currentItemId === event.itemId && status.urgent),
        queuedUrgentIds: without(status.queuedUrgentIds, event.itemId),
      };
    case "outcome":
      return settle(status, event.itemId, event.outcome === "failed" ? AUDIO_PLAYBACK_FAILED_NOTICE : null);
    case "stop":
      return { ...INITIAL_LIVE_AUDIO, notice: status.notice };
    case "dismiss_notice":
      return status.notice === null ? status : { ...status, notice: null };
  }
}

/** Same shape the header and urgent strip already read from the stub. */
export function liveAudioSnapshot(status: LiveAudioStatus): SpeechPlaybackSnapshot {
  return {
    state: status.state,
    text: null,
    urgent: status.urgent,
    queuedUrgent: status.queuedUrgentIds.some((id) => id !== status.currentItemId),
    queuedRoutineCount: 0,
  };
}
