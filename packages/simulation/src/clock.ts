import { SIM_DEFAULTS } from "./model/index.js";

/**
 * Pure mapping from elapsed real play time to the simulated time that is due.
 * Rendering frame rate and provider latency never enter: only a monotonic wall reading does.
 */
export function dueSimTimeMs(wallElapsedMs: number): number {
  const { realPlayLimitMs, simSecondsPerRealSecond, stepMs, incidentHorizonMs } = SIM_DEFAULTS;
  const capped = Math.min(Math.max(0, wallElapsedMs), realPlayLimitMs);
  const raw = capped * simSecondsPerRealSecond;
  return Math.min(incidentHorizonMs, Math.floor(raw / stepMs) * stepMs);
}

/** Wall time at which a given simulated time first becomes due. */
export function wallMsForSimTime(simTimeMs: number): number {
  return Math.ceil(simTimeMs / SIM_DEFAULTS.simSecondsPerRealSecond);
}

export function realPlayExpired(wallElapsedMs: number): boolean {
  return wallElapsedMs >= SIM_DEFAULTS.realPlayLimitMs;
}
