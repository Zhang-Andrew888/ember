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
  turnaroundMs: 5000,
  observationRadiusM: 150,
  staleAfterMs: 30_000,
  crewWorkRate: 1,
  maxDamageReduction: 0.9,
  unprotectedDamageRate: 0.006,
  siteExposureRadiusM: 35,
  baseSpreadRate: 0.5,
  cellBurnMs: 240_000,
  refugeRadiusM: 50,
  spreadRateClamp: [0.1, 2.0],
  windCoefficient: 0.6,
  /** Effective midflame wind speed in game units (m/s); Rothermel wind terms saturate quickly. */
  windSpeedMps: 0.215,
  /** Dead fuel moisture as a fraction of dry weight; the reference at which baseSpreadRate applies. */
  fuelMoisture: 0.08,
  /** Calibration of the Rothermel rate to game scale; keeps overall burn area near the pre-Rothermel model. */
  rothermelGain: 1.2,
  slopeCoefficient: 1.5,
  slopeClamp: 0.5,
  fuelRange: [0.6, 1.4],
  spreadMultiplierRange: [0.6, 1.6],
  windShiftTimeRangeMs: [250_000, 650_000],
  initialWindJitterDeg: 15,
  postShiftRangeDeg: [45, 100],
} as const;

export type SimDefaults = typeof SIM_DEFAULTS;
