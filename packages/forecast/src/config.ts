import type { ForecastParameterRanges, ParameterRanges } from "./types.js";

/** Forecast defaults from docs/NAVIGATION_AGENTS.md. Tunable, never validated probabilities. */
export interface ForecastConfig {
  readonly memberCount: number;
  readonly maxMembers: number;
  readonly horizonMs: number;
  readonly refreshMs: number;
  /** Rollout resolution. Ignition is recorded at the start of the step it occurs in. */
  readonly rolloutStepMs: number;
  /** Max fraction of a footprint whose state may disagree with an observation. */
  readonly disagreementTolerance: number;
  readonly minSupportedForRecovery: number;
  readonly widenFactors: readonly number[];
  readonly rebuildCandidates: number;
  readonly prior: ParameterRanges;
  readonly physicalBounds: ParameterRanges;
  /** Empirical two-sided padding from calibration seeds, applied only to valid bands. */
  readonly arrivalPaddingMs: number;
}

const DEFAULT_PRIOR: ForecastParameterRanges = {
  spreadMultiplier: { min: 0.7, max: 1.3 },
  windOffsetDeg: { min: -30, max: 30 },
  shiftTimeMs: { min: 450_000, max: 650_000 },
  postShiftDeg: { min: 45, max: 100 },
  moistureMultiplier: { min: 0.85, max: 1.15 },
  spotDistanceCells: { min: 0, max: 5 },
  spotTimeMs: { min: 240_000, max: 900_000 },
};

const DEFAULT_BOUNDS: ForecastParameterRanges = {
  spreadMultiplier: { min: 0.3, max: 2.5 },
  windOffsetDeg: { min: -90, max: 90 },
  shiftTimeMs: { min: 60_000, max: 1_500_000 },
  postShiftDeg: { min: 20, max: 140 },
  moistureMultiplier: { min: 0.6, max: 1.5 },
  spotDistanceCells: { min: 0, max: 10 },
  spotTimeMs: { min: 60_000, max: 1_500_000 },
};

export function completeRanges(ranges: ParameterRanges, fallback: ForecastParameterRanges): ForecastParameterRanges {
  return {
    ...ranges,
    moistureMultiplier: ranges.moistureMultiplier ?? fallback.moistureMultiplier,
    spotDistanceCells: ranges.spotDistanceCells ?? fallback.spotDistanceCells,
    spotTimeMs: ranges.spotTimeMs ?? fallback.spotTimeMs,
  };
}

export function priorRanges(config: ForecastConfig): ForecastParameterRanges {
  return completeRanges(config.prior, DEFAULT_PRIOR);
}

export function physicalRanges(config: ForecastConfig): ForecastParameterRanges {
  return completeRanges(config.physicalBounds, DEFAULT_BOUNDS);
}

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  memberCount: 24,
  maxMembers: 32,
  horizonMs: 1_800_000,
  refreshMs: 25_000,
  rolloutStepMs: 5000,
  disagreementTolerance: 0.1,
  minSupportedForRecovery: 8,
  widenFactors: [2, 4, 8],
  rebuildCandidates: 72,
  prior: DEFAULT_PRIOR,
  physicalBounds: DEFAULT_BOUNDS,
  // 90th-percentile residual from cal-01..04; held-11..14 were evaluated separately.
  arrivalPaddingMs: 74_000,
};

/** Widen each prior range around its center by `factor`, clamped to physical bounds. */
export function widenRanges(config: ForecastConfig, factor: number): ForecastParameterRanges {
  const prior = priorRanges(config);
  const bounds = physicalRanges(config);
  const widen = (
    prior: { min: number; max: number },
    bound: { min: number; max: number },
  ): { min: number; max: number } => {
    const center = (prior.min + prior.max) / 2;
    const half = ((prior.max - prior.min) / 2) * factor;
    return { min: Math.max(bound.min, center - half), max: Math.min(bound.max, center + half) };
  };
  return {
    spreadMultiplier: widen(prior.spreadMultiplier, bounds.spreadMultiplier),
    windOffsetDeg: widen(prior.windOffsetDeg, bounds.windOffsetDeg),
    shiftTimeMs: widen(prior.shiftTimeMs, bounds.shiftTimeMs),
    postShiftDeg: widen(prior.postShiftDeg, bounds.postShiftDeg),
    moistureMultiplier: widen(prior.moistureMultiplier, bounds.moistureMultiplier),
    spotDistanceCells: widen(prior.spotDistanceCells, bounds.spotDistanceCells),
    spotTimeMs: widen(prior.spotTimeMs, bounds.spotTimeMs),
  };
}
