/**
 * Quality tiers (docs/ART_DIRECTION: legibility beats decoration; if frame
 * time misses the target, cut decoration first). Everything decorative is
 * switched here; product-critical layers (routes, forecast, crews, sites,
 * observed fire, labels) never depend on the tier.
 */
export type QualityTier = "low" | "medium" | "high";
export const QUALITY_TIERS: readonly QualityTier[] = ["low", "medium", "high"];

export interface QualityConfig {
  /** Multiplier on tree count (vegetation density still decides where). */
  readonly treeDensity: number;
  readonly sway: boolean;
  readonly embers: boolean;
  readonly smoke: boolean;
  readonly bloom: boolean;
  readonly vignette: boolean;
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly dprMax: number;
  /** Flame cards per burning cell. */
  readonly flameCards: number;
}

export const QUALITY: Record<QualityTier, QualityConfig> = {
  low: {
    treeDensity: 0.3,
    sway: false,
    embers: false,
    smoke: false,
    bloom: false,
    vignette: false,
    antialias: false,
    shadows: false,
    dprMax: 1,
    flameCards: 1,
  },
  medium: {
    treeDensity: 0.65,
    sway: true,
    embers: true,
    smoke: false,
    bloom: true,
    vignette: true,
    antialias: true,
    shadows: false,
    dprMax: 1.25,
    flameCards: 2,
  },
  high: {
    treeDensity: 1,
    sway: true,
    embers: true,
    smoke: true,
    bloom: true,
    vignette: true,
    antialias: true,
    shadows: true,
    dprMax: 1.5,
    flameCards: 3,
  },
};

/**
 * Reduced motion removes everything that animates or glows on its own:
 * sway, embers, smoke, bloom and vignette (docs/FRONTEND.md "honor
 * reduced-motion"). Static decoration (trees, flame cards held steady) stays.
 */
export function effectiveQuality(tier: QualityTier, reducedMotion: boolean): QualityConfig {
  const base = QUALITY[tier];
  if (!reducedMotion) return base;
  return { ...base, sway: false, embers: false, smoke: false, bloom: false, vignette: false };
}
