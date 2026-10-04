/**
 * Versioned simulation defaults from docs/SIMULATION.md and docs/NAVIGATION_AGENTS.md.
 * These are game parameters, not validated wildfire physics.
 */
export const MODEL_VERSION = "model-v1";

export const SIM_DEFAULTS = {
  gridSize: 64,
  cellMeters: 25,
  realPlayLimitMs: 300_000,
  simSecondsPerRealSecond: 5,
  stepMs: 1000,
  incidentHorizonMs: 1_500_000,
  agentSpeedMps: 4,
  /** Off-road travel uses this fraction of road speed (initial #120 setting). */
  offRoadSpeedFactor: 0.5,
  turnaroundMs: 5000,
  observationRadiusM: 150,
  staleAfterMs: 30_000,
  crewWorkRate: 1,
  maxDamageReduction: 0.9,
  unprotectedDamageRate: 0.006,
  siteExposureRadiusM: 35,
  /** Max distance from a road node to a grid cell center for on-road containment work (not off-road travel). */
  containmentReachM: 300,
  /** Work-units per second while a crew performs suppress_fire at an reachable node. */
  containmentWorkRate: 1,
  /** Accumulated work-units to fully restrain spread from a burning cell (deterministic game param). */
  containmentWorkRequired: 45,
  /** Work-units to clear one fire-line cell to bare ground (15 s for one crew; Phase 0 feasibility runs). */
  lineWorkPerCell: 15,
  /** Work-units per second while a crew clears a fire line. */
  lineWorkRate: 1,
  /** A crew clears line cells within this distance of the node it works from. */
  lineReachM: 400,
  baseSpreadRate: 0.5,
  cellBurnMs: 240_000,
  refugeRadiusM: 50,
  spreadRateClamp: [0.1, 2.0],
  windCoefficient: 0.6,
  slopeCoefficient: 1.5,
  slopeClamp: 0.5,
  fuelRange: [0.6, 1.4],
  spreadMultiplierRange: [0.6, 1.6],
  windShiftTimeRangeMs: [250_000, 650_000],
  initialWindJitterDeg: 15,
  postShiftRangeDeg: [45, 100],
} as const;

export type SimDefaults = typeof SIM_DEFAULTS;
