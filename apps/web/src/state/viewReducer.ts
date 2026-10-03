import type { CoordinatorView } from "@ember/domain";

/**
 * Keeps the newest CoordinatorView seen so far: the highest sequence, and at an equal sequence the
 * later simTimeMs (a server that holds its sequence while simulated time advances must not freeze the
 * clock; see issue #53). The server sends
 * ordered snapshots (docs/ARCHITECTURE.md: "Send state at 5 Hz with sequence
 * numbers"); a reconnect or reordering can deliver an older frame, which
 * must never roll the displayed state backwards.
 */
export function applyIncomingView(
  current: CoordinatorView | null,
  incoming: CoordinatorView,
): CoordinatorView {
  if (!current || incoming.sequence > current.sequence) return incoming;
  if (incoming.sequence === current.sequence && incoming.simTimeMs > current.simTimeMs) return incoming;
  return current;
}
