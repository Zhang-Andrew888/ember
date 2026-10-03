import { describe, expect, it } from "vitest";
import { ageOf, freshness, FULL_FADE_MS, MIN_OPACITY, STALE_AFTER_MS } from "./staleness.js";

describe("freshness", () => {
  it("fresh information is fully opaque with no age label", () => {
    expect(freshness(0)).toEqual({ stale: false, opacity: 1, ageLabel: null });
    expect(freshness(STALE_AFTER_MS)).toMatchObject({ stale: false, opacity: 1 });
  });

  it("just past the threshold is stale but still nearly opaque, with an age label", () => {
    const f = freshness(STALE_AFTER_MS + 1000);
    expect(f.stale).toBe(true);
    expect(f.opacity).toBeLessThan(1);
    expect(f.opacity).toBeGreaterThan(0.95);
    expect(f.ageLabel).toBe("seen 0:31 ago");
  });

  it("fades monotonically with age and bottoms out at MIN_OPACITY", () => {
    const ages = [31_000, 60_000, 100_000, FULL_FADE_MS, FULL_FADE_MS * 10];
    const opacities = ages.map((age) => freshness(age).opacity);
    for (let i = 1; i < opacities.length; i++) expect(opacities[i]!).toBeLessThanOrEqual(opacities[i - 1]!);
    expect(opacities[opacities.length - 1]).toBe(MIN_OPACITY);
  });

  it("never observed is treated as stale, not fresh", () => {
    expect(freshness(null)).toMatchObject({ stale: true, opacity: MIN_OPACITY, ageLabel: "never observed" });
  });

  it("honours a server stale flag even when the age looks recent", () => {
    expect(freshness(5000, true).stale).toBe(true);
  });

  it("negative ages (clock skew) read as fresh, not NaN", () => {
    expect(freshness(-500)).toMatchObject({ stale: false, opacity: 1 });
  });
});

describe("ageOf", () => {
  it("is sim time minus observation time, null when never observed, never negative", () => {
    expect(ageOf(90_000, 85_000)).toBe(5000);
    expect(ageOf(90_000, null)).toBeNull();
    expect(ageOf(10_000, 20_000)).toBe(0);
  });
});
