import type { CoordinatorView } from "@ember/domain";

/**
 * Keeps the highest-sequence CoordinatorView seen so far. The server sends
 * ordered snapshots (docs/ARCHITECTURE.md: "Send state at 5 Hz with sequence
 * numbers"); a reconnect or reordering can deliver an older frame, which
 * must never roll the displayed state backwards.
 */
export function applyIncomingView(
  current: CoordinatorView | null,
  incoming: CoordinatorView,
): CoordinatorView {
  if (!current || incoming.sequence > current.sequence) return incoming;
  return current;
}
