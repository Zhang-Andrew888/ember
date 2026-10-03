import { describe, expect, it } from "vitest";
import { createHeightField, VERTICAL_SCALE } from "./heightField.js";
import {
  chooseWaterCells,
  chooseWaterLevel,
  roadSamplePoints,
  sceneTerrain,
  waterCells,
  waterLevel,
  WATER_ROAD_CLEARANCE,
} from "./sceneTerrain.js";

function tiny(heights: number[], fuel?: number[]) {
  return createHeightField({ gridSize: 2, cellMeters: 25, height: heights, fuel: fuel ?? heights.map(() => 1) });
}

describe("createHeightField", () => {
  it("shifts the lowest cell to zero and applies the vertical scale", () => {
    const field = tiny([10, 20, 30, 40]);
    expect(field.cellHeight(0)).toBe(0);
    expect(field.cellHeight(3)).toBeCloseTo(30 * VERTICAL_SCALE);
  });

  it("interpolates between corners and clamps outside the field", () => {
    const field = tiny([0, 0, 0, 100]);
    const inside = field.groundY(0, 0);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThanOrEqual(field.maxHeight);
    expect(field.groundY(99999, 99999)).toBeCloseTo(field.groundY(700, 700));
  });

  it("is flat when the scenario has no terrain", () => {
    const flat = createHeightField(null);
    expect(flat.maxHeight).toBe(0);
    expect(flat.groundY(10, 10)).toBe(0);
  });

  it("maps cell index <-> scene position consistently", () => {
    const field = createHeightField(null);
    for (const index of [0, 63, 64, 2825, 4095]) {
      const centre = field.cellCenter(index);
      expect(field.cellIndexAt(centre.x, centre.z)).toBe(index);
    }
    expect(field.cellIndexAt(-5000, 0)).toBeNull();
  });
});

describe("scene terrain water", () => {
  it("never places water within the clearance of a road or node", () => {
    const roads = roadSamplePoints();
    for (const index of waterCells) {
      const centre = sceneTerrain.cellCenter(index);
      for (const p of roads) {
        expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeGreaterThan(WATER_ROAD_CLEARANCE);
      }
    }
  });

  it("still has ponds, all below the water level", () => {
    expect(waterCells.length).toBeGreaterThan(10);
    for (const index of waterCells) expect(sceneTerrain.cellHeight(index)).toBeLessThan(waterLevel);
  });

  it("chooseWaterLevel rises with the quantile", () => {
    expect(chooseWaterLevel(sceneTerrain, 0.3)).toBeGreaterThan(chooseWaterLevel(sceneTerrain, 0.05));
  });

  it("excludes cells beside a road", () => {
    const flat = createHeightField(null);
    const wet = chooseWaterLevel(flat); // flat field: nothing is below the level
    expect(chooseWaterCells(flat, wet + 1, [{ x: 0, z: 0 }]).length).toBeLessThan(flat.gridSize ** 2);
  });
});
