import { describe, expect, it } from "vitest";
import { fuelDensity, terrainColor } from "./terrainColor.js";

describe("terrainColor", () => {
  it("denser vegetation is greener and darker than sparse", () => {
    const sparse = terrainColor(0, 0.2);
    const dense = terrainColor(1, 0.2);
    expect(dense[1]).toBeGreaterThan(dense[0]); // green dominant
    expect(dense[0]).toBeLessThan(sparse[0]);
  });

  it("higher bands are lighter", () => {
    expect(terrainColor(0.5, 0.9)[1]).toBeGreaterThan(terrainColor(0.5, 0.05)[1]);
  });

  it("stays within displayable range and clamps inputs", () => {
    for (const c of [terrainColor(-5, -1), terrainColor(5, 5)]) for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
    expect(Math.max(...terrainColor(5, 5))).toBeLessThanOrEqual(1);
  });

  it("maps the scenario fuel range onto 0..1", () => {
    expect(fuelDensity(0.6)).toBe(0);
    expect(fuelDensity(1.4)).toBeCloseTo(1);
    expect(fuelDensity(9)).toBe(1);
  });
});
