import { useSyncExternalStore } from "react";
import type { SpeechPlaybackSnapshot, SpeechPlaybackStub } from "./speechPlaybackStub.js";

const IDLE_SNAPSHOT: SpeechPlaybackSnapshot = { state: "idle", text: null, urgent: false };

/** Subscribes a component tree to a SpeechPlaybackStub instance (see App.tsx for lifecycle ownership). */
export function useSpeechPlaybackStub(stub: SpeechPlaybackStub | null): SpeechPlaybackSnapshot {
  return useSyncExternalStore(
    stub ? stub.subscribe : () => () => {},
    stub ? stub.getSnapshot : () => IDLE_SNAPSHOT,
  );
}
