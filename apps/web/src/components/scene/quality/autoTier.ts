import type { QualityTier } from "./tiers.js";
import { QUALITY_TIERS } from "./tiers.js";

/**
 * Automatic tier choice from measured render cost. Target is >= 30 fps
 * (docs/FRONTEND.md), i.e. a ~33 ms budget: step DOWN when the recent
 * 75th-percentile frame cost exceeds DOWN_MS, step UP only after a full
 * window comfortably under UP_MS and a cooldown, so the tier never flaps.
 * A tier we just stepped down from is not retried for BAN_MS.
 */
export const DOWN_MS = 36;
export const UP_MS = 14;
export const WINDOW = 24;
export const COOLDOWN_MS = 6_000;
export const BAN_MS = 60_000;

export interface AutoTierState {
  readonly tier: QualityTier;
  readonly samples: readonly number[];
  readonly lastChangeAt: number;
  /** Tier -> time until which we will not step up into it. */
  readonly bannedUntil: Readonly<Partial<Record<QualityTier, number>>>;
}

export function initialAutoTier(tier: QualityTier = "high", now = 0): AutoTierState {
  return { tier, samples: [], lastChangeAt: now, bannedUntil: {} };
}

export function percentile75(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))]!;
}

export function recordFrame(state: AutoTierState, frameMs: number, nowMs: number): AutoTierState {
  const samples = [...state.samples, frameMs].slice(-WINDOW);
  if (samples.length < WINDOW) return { ...state, samples };
  const p75 = percentile75(samples);
  const index = QUALITY_TIERS.indexOf(state.tier);

  if (p75 > DOWN_MS && index > 0) {
    return {
      tier: QUALITY_TIERS[index - 1]!,
      samples: [],
      lastChangeAt: nowMs,
      bannedUntil: { ...state.bannedUntil, [state.tier]: nowMs + BAN_MS },
    };
  }
  const next = QUALITY_TIERS[index + 1];
  if (
    p75 < UP_MS &&
    next !== undefined &&
    nowMs - state.lastChangeAt >= COOLDOWN_MS &&
    nowMs >= (state.bannedUntil[next] ?? 0)
  ) {
    return { ...state, tier: next, samples: [], lastChangeAt: nowMs };
  }
  return { ...state, samples };
}
