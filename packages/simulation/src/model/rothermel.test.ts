import { createTerrain } from "./terrain.js";
import { spreadRate } from "./fire.js";
import { describe, expect, it } from "vitest";
import {
  FUEL_GRASS,
  FUEL_MODELS,
  FUEL_SHRUB,
  FUEL_TIMBER,
  ellipseEccentricity,
  ellipseFactor,
  noWindRateFtMin,
  rothermelPhiS,
  rothermelPhiW,
} from "./rothermel.js";

const shrub = FUEL_MODELS[FUEL_SHRUB]!;

describe("model/rothermel", () => {
  it("gives a positive no-wind rate that falls as moisture rises and vanishes at extinction", () => {
    const dry = noWindRateFtMin(shrub, 0.05);
    const damp = noWindRateFtMin(shrub, 0.15);
    expect(dry).toBeGreaterThan(damp);
    expect(damp).toBeGreaterThan(0);
    expect(noWindRateFtMin(shrub, shrub.mx)).toBeCloseTo(0, 6);
  });

  it("ranks grass faster than shrub faster than timber litter at equal moisture", () => {
    const r = [FUEL_GRASS, FUEL_SHRUB, FUEL_TIMBER].map((m) => noWindRateFtMin(FUEL_MODELS[m]!, 0.06));
    expect(r[0]!).toBeGreaterThan(r[1]!);
    expect(r[1]!).toBeGreaterThan(r[2]!);
  });

  it("wind and slope coefficients grow monotonically; downhill slope adds nothing", () => {
    expect(rothermelPhiW(shrub, 0)).toBe(0);
    expect(rothermelPhiW(shrub, 0.5)).toBeGreaterThan(rothermelPhiW(shrub, 0.25));
    expect(rothermelPhiS(shrub, -0.2)).toBe(0);
    expect(rothermelPhiS(shrub, 0.2)).toBeGreaterThan(rothermelPhiS(shrub, 0.1));
  });

  it("builds an ellipse that is a circle in calm air and elongates with wind", () => {
    expect(ellipseEccentricity(0)).toBe(0);
    expect(ellipseFactor(0, -1)).toBe(1);
    const e = ellipseEccentricity(5);
    expect(e).toBeGreaterThan(0.5);
    expect(ellipseFactor(e, 1)).toBe(1);
    expect(ellipseFactor(e, -1)).toBeLessThan(ellipseFactor(e, 0));
    expect(ellipseFactor(e, 0)).toBeLessThan(1);
  });

  it("assigns a valid fuel model to every terrain cell, using more than one type", () => {
    const t = createTerrain("rothermel-terrain");
    const kinds = new Set(t.fuelModel);
    expect(kinds.size).toBeGreaterThan(1);
    for (const k of kinds) expect(k).toBeLessThan(FUEL_MODELS.length);
  });

  it("slows the cell spread rate in wetter fuel and speeds it uphill", () => {
    const east = { dx: 1, dy: 0, dist: 25, ux: 1, uy: 0 };
    const p = { spreadMultiplier: 1, initialWindRad: 0, windShiftMs: Infinity, postShiftWindRad: 0 };
    const dry = spreadRate({ ...p, moisture: 0.05 }, 0, east, 1, 0);
    const wet = spreadRate({ ...p, moisture: 0.12 }, 0, east, 1, 0);
    expect(wet).toBeLessThan(dry);
    expect(spreadRate(p, 0, east, 1, 5)).toBeGreaterThan(spreadRate(p, 0, east, 1, 0));
  });
});
