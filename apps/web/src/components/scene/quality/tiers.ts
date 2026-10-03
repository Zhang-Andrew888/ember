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
  /** Pixel-ratio clamp [min, max] handed to the Canvas. Low renders below native resolution (labels stay crisp: they are DOM). */
  readonly dpr: readonly [number, number];
  /** Cheaper tree geometry (one cone) on the low tier. */
  readonly simpleTrees: boolean;
  /** Lambert shading instead of PBR for ground and trees (much cheaper per pixel). */
  readonly cheapLighting: boolean;
  /** Flame cards per burning cell. */
  readonly flameCards: number;
}

export const QUALITY: Record<QualityTier, QualityConfig> = {
  low: {
    treeDensity: 0.12,
    sway: false,
    embers: false,
    smoke: false,
    bloom: false,
    vignette: false,
    antialias: false,
    shadows: false,
    dpr: [0.75, 0.75],
    simpleTrees: true,
    cheapLighting: true,
    flameCards: 1,
  },
  medium: {
    treeDensity: 0.45,
    sway: true,
    embers: true,
    smoke: false,
    bloom: true,
    vignette: true,
    antialias: true,
    shadows: false,
    dpr: [1, 1.25],
    simpleTrees: false,
    cheapLighting: true,
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
    dpr: [1, 1.5],
    simpleTrees: false,
    cheapLighting: false,
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
