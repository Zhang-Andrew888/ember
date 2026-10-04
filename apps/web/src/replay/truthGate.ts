import type { CoordinatorCurrentFireView } from "@ember/domain";
import type { ReplayTruthFrame } from "./recording.js";

export type AppPhase = "briefing" | "live" | "replay";

/**
 * Gate for the REPLAY truth: the full simulated fire, which the coordinator was never told.
 * It returns the frame ONLY in replay with the explicit toggle on; in every other phase -
 * including `live`, whatever the toggle or data - it returns null. ReplayView is the sole caller.
 * Live play never gets this frame; the only fire it may show is `currentFireForDisplay` below.
 */
export function truthForDisplay(input: {
  readonly phase: AppPhase;
  readonly showFullFire: boolean;
  readonly frame: ReplayTruthFrame | null;
}): ReplayTruthFrame | null {
  if (input.phase !== "replay") return null;
  if (!input.showFullFire) return null;
  return input.frame;
}

/**
 * Gate for the authorized live current fire (#112/#114): `CoordinatorView.currentFire`, built only
 * for the coordinator's own stream. It is what the coordinator is allowed to see right now - cells
 * burning or burned at the view's simTimeMs - and never private parameters or future state, which
 * the domain schema cannot carry. Shown while a run is live (and in replay, where the recorded
 * view carries what the coordinator was authorized to see at that time); the briefing has no run.
 * Returns null when the sender does not provide it, so nothing is invented.
 */
export function currentFireForDisplay(input: {
  readonly phase: AppPhase;
  readonly currentFire: CoordinatorCurrentFireView | undefined;
}): CoordinatorCurrentFireView | null {
  if (input.phase === "briefing") return null;
  return input.currentFire ?? null;
}
