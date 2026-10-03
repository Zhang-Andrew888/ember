import { describe, expect, it } from "vitest";
import { effectiveQuality, QUALITY, QUALITY_TIERS } from "./tiers.js";

describe("quality tiers", () => {
  it("each step up never reduces any decoration", () => {
    for (let i = 1; i < QUALITY_TIERS.length; i++) {
      const lower = QUALITY[QUALITY_TIERS[i - 1]!];
      const higher = QUALITY[QUALITY_TIERS[i]!];
      expect(higher.treeDensity).toBeGreaterThanOrEqual(lower.treeDensity);
      expect(higher.flameCards).toBeGreaterThanOrEqual(lower.flameCards);
      expect(higher.dprMax).toBeGreaterThanOrEqual(lower.dprMax);
      for (const key of ["sway", "embers", "smoke", "bloom", "vignette", "antialias", "shadows"] as const) {
        expect(Number(higher[key]), key).toBeGreaterThanOrEqual(Number(lower[key]));
      }
    }
  });

  it("caps pixel ratio at 1.5 (docs/FRONTEND.md)", () => {
    for (const tier of QUALITY_TIERS) expect(QUALITY[tier].dprMax).toBeLessThanOrEqual(1.5);
  });

  it("reduced motion turns off every self-animating or glowing effect on every tier", () => {
    for (const tier of QUALITY_TIERS) {
      const q = effectiveQuality(tier, true);
      expect([q.sway, q.embers, q.smoke, q.bloom, q.vignette]).toEqual([false, false, false, false, false]);
      expect(q.treeDensity).toBe(QUALITY[tier].treeDensity);
    }
  });

  it("leaves the tier untouched when motion is allowed", () => {
    expect(effectiveQuality("high", false)).toBe(QUALITY.high);
  });
});
