/**
 * simTimeMs and wallElapsedMs are never interchangeable (see CLAUDE.md
 * simulation rules). Each formatter below is explicit about which one it
 * takes so a callsite can't accidentally mix them.
 */

const INCIDENT_WALL_LIMIT_MS = 5 * 60 * 1000;

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
