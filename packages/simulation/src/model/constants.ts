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
  /**
   * Head-fire rate in m/s for the reference case: shrub fuel, reference moisture, effective wind, flat
   * ground, spread multiplier 1. The Rothermel rate is scaled so this case lands exactly here.
   */
  referenceHeadRateMps: 1.1,
  /** Factor from the effective midflame wind to the 20-ft wind that sets the fire ellipse's elongation. */
  ellipseWindFactor: 2,
  /** Canopy base height (m) and foliar moisture (% dry weight) for the Van Wagner crown-initiation threshold. */
  canopyBaseHeightM: 8,
  foliarMoisturePct: 100,
  /** Crown fire multiplies the surface spread rate by this factor, up to crownRateMax (m/s). */
  crownRateFactor: 1.8,
  crownRateMax: 3.0,
  /** Spotting: embers loft from burning cells whose head intensity (kW/m) reaches this. */
  spotMinIntensityKwM: 3000,
  /** Per-step probability of a spot from one such cell at the minimum intensity; scales with intensity up to 5x. */
  spotProbPerStep: 0.0006,
  /** Crown-fire cells loft embers this many times as often. */
  spotCrownBoost: 3,
  /** Mean landing distance in meters per meter of flame length. */
  spotDistancePerFlameM: 20,
  /** Half-width (rad) of the angular scatter around the wind direction. */
  spotAngleSpreadRad: 0.35,
  /** Embers must land at least this many cells away; closer ignitions are ordinary spread. */
  spotMinCells: 2,
  slopeCoefficient: 1.5,
  slopeClamp: 0.5,
  fuelRange: [0.6, 1.4],
  spreadMultiplierRange: [0.6, 1.6],
  windShiftTimeRangeMs: [250_000, 650_000],
  initialWindJitterDeg: 15,
  postShiftRangeDeg: [45, 100],
} as const;

export type SimDefaults = typeof SIM_DEFAULTS;
