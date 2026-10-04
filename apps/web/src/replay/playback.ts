/** Wall-clock delay before advancing to the next coordinator log entry during replay play. */
export function replayStepDelayMs(simDeltaMs: number, reducedMotion: boolean): number {
  const scale = reducedMotion ? 15 : 30;
  const cap = reducedMotion ? 1500 : 800;
  const scaled = simDeltaMs / scale;
  return Math.max(80, Math.min(cap, scaled));
}
