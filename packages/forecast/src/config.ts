import type { ParameterRanges } from "./types.js";

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
  prior: {
    spreadMultiplier: { min: 0.7, max: 1.3 },
    windOffsetDeg: { min: -30, max: 30 },
    shiftTimeMs: { min: 450_000, max: 650_000 },
    postShiftDeg: { min: 45, max: 100 },
  },
  physicalBounds: {
    spreadMultiplier: { min: 0.3, max: 2.5 },
    windOffsetDeg: { min: -90, max: 90 },
    shiftTimeMs: { min: 60_000, max: 1_500_000 },
    postShiftDeg: { min: 20, max: 140 },
  },
};

/** Widen each prior range around its center by `factor`, clamped to physical bounds. */
export function widenRanges(config: ForecastConfig, factor: number): ParameterRanges {
  const widen = (
    prior: { min: number; max: number },
    bound: { min: number; max: number },
  ): { min: number; max: number } => {
    const center = (prior.min + prior.max) / 2;
    const half = ((prior.max - prior.min) / 2) * factor;
    return { min: Math.max(bound.min, center - half), max: Math.min(bound.max, center + half) };
  };
  return {
    spreadMultiplier: widen(config.prior.spreadMultiplier, config.physicalBounds.spreadMultiplier),
    windOffsetDeg: widen(config.prior.windOffsetDeg, config.physicalBounds.windOffsetDeg),
    shiftTimeMs: widen(config.prior.shiftTimeMs, config.physicalBounds.shiftTimeMs),
    postShiftDeg: widen(config.prior.postShiftDeg, config.physicalBounds.postShiftDeg),
  };
}
