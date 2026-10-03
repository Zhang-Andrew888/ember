import { describe, expect, it } from "vitest";
import { createHeightField } from "../terrain/heightField.js";
import { burnByCell, CHAR, placeTrees, treeBrightness } from "./treePlacement.js";
import { createProximityTest } from "./roadMask.js";
import { sceneTerrain, waterCells, roadSamplePoints } from "../terrain/sceneTerrain.js";

const none = () => false;
const noWater = new Set<number>();

function terrainWithFuel(fuelValue: number) {
  const n = 4;
  return createHeightField({
    gridSize: n,
    cellMeters: 25,
    height: new Array(n * n).fill(0),
    fuel: new Array(n * n).fill(fuelValue),
  });
}

describe("placeTrees", () => {
  it("is deterministic", () => {
    const field = terrainWithFuel(1);
    const a = placeTrees({ field, blocked: none, waterCells: noWater, densityFactor: 1 });
    const b = placeTrees({ field, blocked: none, waterCells: noWater, densityFactor: 1 });
    expect(a).toEqual(b);
  });

  it("grows more trees where vegetation is denser, and fewer on lower tiers", () => {
    const sparse = placeTrees({ field: terrainWithFuel(0.6), blocked: none, waterCells: noWater, densityFactor: 1 });
    const dense = placeTrees({ field: terrainWithFuel(1.4), blocked: none, waterCells: noWater, densityFactor: 1 });
    const denseLow = placeTrees({ field: terrainWithFuel(1.4), blocked: none, waterCells: noWater, densityFactor: 0.3 });
    expect(dense.length).toBeGreaterThan(sparse.length);
    expect(denseLow.length).toBeLessThan(dense.length);
  });

  it("keeps trees out of blocked areas and water cells", () => {
    const field = terrainWithFuel(1.4);
    const trees = placeTrees({ field, blocked: (x) => x < 0, waterCells: new Set([15]), densityFactor: 1 });
    expect(trees.length).toBeGreaterThan(0);
    for (const tree of trees) {
      expect(tree.x).toBeGreaterThanOrEqual(0);
      expect(tree.cell).not.toBe(15);
    }
  });

  it("places trees on the ground with varied scale, rotation and tint", () => {
    const trees = placeTrees({ field: terrainWithFuel(1.4), blocked: none, waterCells: noWater, densityFactor: 1 });
    expect(new Set(trees.map((t) => t.scale.toFixed(2))).size).toBeGreaterThan(5);
    for (const t of trees) {
      expect(t.y).toBe(0);
      expect(t.tint).toBeGreaterThanOrEqual(0.85);
      expect(t.tint).toBeLessThanOrEqual(1.15);
      expect([0, 1]).toContain(t.species);
    }
  });

  it("on the real scenario, grows a forest that avoids every road and pond", () => {
    const roads = roadSamplePoints();
    const blocked = createProximityTest(roads, 14);
    const trees = placeTrees({ field: sceneTerrain, blocked, waterCells: new Set(waterCells), densityFactor: 1 });
    expect(trees.length).toBeGreaterThan(1000);
    expect(trees.length).toBeLessThan(15000);
    for (const t of trees.slice(0, 500)) expect(blocked(t.x, t.z)).toBe(false);
  });
});

describe("tree char", () => {
  const tree = { x: 0, y: 0, z: 0, cell: 1, species: 0 as const, scale: 1, rotation: 0, tint: 1 };

  it("observed fire darkens trees, and burned is darkest", () => {
    expect(treeBrightness(tree, "burning")).toBeLessThan(treeBrightness(tree, undefined));
    expect(treeBrightness(tree, "burned")).toBeLessThan(treeBrightness(tree, "burning"));
  });

  it("a stale burning observation is less charred than a fresh one (we are less sure)", () => {
    expect(CHAR["burning-stale"]).toBeGreaterThan(CHAR.burning);
  });
});

describe("createProximityTest", () => {
  it("detects points within the radius, including across bucket edges", () => {
    const near = createProximityTest([{ x: 31, z: 0 }], 10);
    expect(near(35, 0)).toBe(true);
    expect(near(25, 0)).toBe(true);
    expect(near(60, 0)).toBe(false);
  });
});

describe("burnByCell", () => {
  it("maps only observed fire: burning (fresh/stale) and burned; unburned leaves the trees green", () => {
    const map = burnByCell([
      { gridCellIndex: 1, burnState: "burning", stale: false },
      { gridCellIndex: 2, burnState: "burning", stale: true },
      { gridCellIndex: 3, burnState: "burned", stale: true },
      { gridCellIndex: 4, burnState: "unburned", stale: false },
    ]);
    expect(map.get(1)).toBe("burning");
    expect(map.get(2)).toBe("burning-stale");
    expect(map.get(3)).toBe("burned");
    expect(map.has(4)).toBe(false);
    expect(map.size).toBe(3);
  });

  it("knows nothing about cells that were never observed", () => {
    expect(burnByCell([]).size).toBe(0);
  });
});
