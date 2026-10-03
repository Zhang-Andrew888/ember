import type { ReplayTruthFrame } from "./recording.js";

export type AppPhase = "briefing" | "live" | "replay";

/**
 * The only function that decides whether the full fire may be displayed.
 * It returns the frame ONLY in replay with the explicit toggle on; in every
 * other phase - including `live`, whatever the toggle or data - it returns
 * null. ReplayView is the sole caller.
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
