const WALL_LIMIT_MS = 5 * 60 * 1000;

/**
 * Recorded-playback wall time: frames are delivered on their recorded wall offsets, so playback
 * time is the first frame's wall time plus real time since it arrived. Never earlier than the
 * latest frame, never past the five-minute limit.
 */
export function playbackWallElapsedMs(
  latestFrameWallElapsedMs: number,
  first: { readonly wallElapsedMs: number; readonly atMs: number },
  nowMs: number,
): number {
  const sinceFirst = first.wallElapsedMs + Math.max(0, nowMs - first.atMs);
  return Math.min(WALL_LIMIT_MS, Math.max(latestFrameWallElapsedMs, sinceFirst));
}
