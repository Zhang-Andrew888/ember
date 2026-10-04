/**
 * simTimeMs and wallElapsedMs are never interchangeable (see CLAUDE.md
 * simulation rules). Each formatter below is explicit about which one it
 * takes so a callsite can't accidentally mix them.
 */

const INCIDENT_WALL_LIMIT_MS = 5 * 60 * 1000;

/**
 * The incident covers 25 simulated minutes (the simulation's incidentHorizonMs of 1,500,000 ms) in
 * the five-minute wall limit, so the incident clock runs this many times faster than the wall clock.
 * Kept as a local display constant: the web lane does not import simulation packages.
 */
export const INCIDENT_SIM_HORIZON_MS = 25 * 60 * 1000;
export const TIME_COMPRESSION = INCIDENT_SIM_HORIZON_MS / INCIDENT_WALL_LIMIT_MS;

function formatMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Incident clock readout, built strictly from simTimeMs. */
export function formatIncidentClock(simTimeMs: number): string {
  return formatMmSs(simTimeMs);
}

/** Remaining real time against the fixed five-minute wall limit. */
export function formatRemainingWallTime(wallElapsedMs: number): string {
  return formatMmSs(Math.max(0, INCIDENT_WALL_LIMIT_MS - wallElapsedMs));
}

/** Real time elapsed, built strictly from wallElapsedMs (end overlay). */
export function formatElapsedWallTime(wallElapsedMs: number): string {
  return formatMmSs(wallElapsedMs);
}
