import { describe, expect, it } from "vitest";
import { NodeId, EdgeId } from "@ember/domain";
import {
  CELL_BURNED,
  CELL_BURNING,
  CELL_NONBURNABLE,
  CELL_UNBURNED,
  FireField,
  RoadIndex,
  SIM_DEFAULTS,
  canonicalJson,
  cellCenter,
  cellIndexOf,
  cellsWithin,
  createTerrain,
  hashValue,
  spreadRate,
  streamRng,
  type FireParams,
  type PublicMap,
} from "./index.js";

const params: FireParams = {
  spreadMultiplier: 1,
  initialWindRad: 0,
  windShiftMs: Infinity,
  postShiftWindRad: Math.PI / 2,
};

const flatTerrain = () => ({
  fuel: new Float64Array(64 * 64).fill(1),
  height: new Float64Array(64 * 64),
});

describe("model/rng", () => {
  it("is deterministic per seed and label", () => {
    const a = streamRng("seed", "world");
    const b = streamRng("seed", "world");
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("keeps streams with different labels independent", () => {
    expect(streamRng("seed", "world").next()).not.toBe(streamRng("seed", "forecast").next());
  });

  it("hashes equal values equally regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: [1, 2] })).toBe(canonicalJson({ a: [1, 2], b: 1 }));
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});

describe("model/grid and roads", () => {
  it("maps points to cells and back", () => {
    const idx = cellIndexOf(30, 60);
    expect(idx).toBe(2 * 64 + 1);
    expect(cellCenter(idx ?? -1)).toEqual({ x: 37.5, y: 62.5 });
    expect(cellIndexOf(-1, 5)).toBeNull();
    expect(cellIndexOf(1600, 5)).toBeNull();
  });

  it("traces the cells a road crosses and tiles the edge length", () => {
    const map: PublicMap = {
      nodes: [
        { id: NodeId.parse("a"), x: 10, y: 10 },
        { id: NodeId.parse("b"), x: 110, y: 10 },
      ],
      edges: [
        { id: EdgeId.parse("e"), from: NodeId.parse("a"), to: NodeId.parse("b"), via: [], singleCapacity: false },
      ],
      sites: [],
      refuges: [],
      scoutPoints: [],
      terrainSeed: "t",
      initialFireCells: [],
    };
    const road = new RoadIndex(map);
    const edge = road.mustEdge(EdgeId.parse("e"));
    expect(edge.length).toBeCloseTo(100);
    expect(edge.cells.map((c) => c.cell)).toEqual([0, 1, 2, 3, 4]);
    expect(edge.cells[0]?.startDist).toBe(0);
    expect(edge.cells[4]?.endDist).toBeCloseTo(100);
    expect(road.edgesByCell.get(2)).toEqual([EdgeId.parse("e")]);
  });
});

describe("model/terrain", () => {
  it("is deterministic and keeps fuel in range", () => {
    const a = createTerrain("t1");
    const b = createTerrain("t1");
    expect(Array.from(a.fuel.slice(0, 20))).toEqual(Array.from(b.fuel.slice(0, 20)));
    expect(Math.min(...a.fuel)).toBeGreaterThanOrEqual(0.6);
    expect(Math.max(...a.fuel)).toBeLessThanOrEqual(1.4);
    expect(createTerrain("t2").height[100]).not.toBe(a.height[100]);
  });
});

describe("model/fire", () => {
  it("spreads faster downwind than upwind and clamps the rate", () => {
    const east = { dx: 1, dy: 0, dist: 25, ux: 1, uy: 0 };
    const west = { dx: -1, dy: 0, dist: 25, ux: -1, uy: 0 };
    const down = spreadRate(params, 0, east, 1, 0);
    const up = spreadRate(params, 0, west, 1, 0);
    expect(down).toBeGreaterThan(up);
    expect(down).toBeCloseTo(0.5 * Math.exp(0.6), 6);
    expect(spreadRate({ ...params, spreadMultiplier: 10 }, 0, east, 1.4, 0)).toBe(2.0);
    expect(spreadRate({ ...params, spreadMultiplier: 0.01 }, 0, west, 0.6, 0)).toBe(0.1);
  });

  it("raises the rate uphill using clamped slope", () => {
    const east = { dx: 1, dy: 0, dist: 25, ux: 1, uy: 0 };
    expect(spreadRate(params, 0, east, 1, 10)).toBeGreaterThan(spreadRate(params, 0, east, 1, 0));
  });

  it("ignites a downwind neighbor after accumulated progress and burns out after 240 s", () => {
    const field = new FireField(flatTerrain(), new Set());
    const start = 32 * 64 + 10;
    field.ignite([start], 0);
    let ignitedEast = Infinity;
    for (let t = 1000; t <= 300_000; t += 1000) {
      field.step(t, 1000, params);
      if (ignitedEast === Infinity && field.state[start + 1] !== CELL_UNBURNED) ignitedEast = t;
    }
    // 25 m at 0.5 * exp(0.6) m/s is about 27.4 s, so ignition lands on step 28.
    expect(ignitedEast).toBe(28_000);
    expect(field.ignitedAtMs[start + 1]).toBe(28_000);
    expect(field.state[start]).toBe(CELL_BURNED);
  });

  it("keeps a cell burning until its timer expires, then burned", () => {
    const field = new FireField(flatTerrain(), new Set());
    field.ignite([100], 0);
    field.step(239_000, 1000, params);
    expect(field.state[100]).toBe(CELL_BURNING);
    field.step(240_000, 1000, params);
    expect(field.state[100]).toBe(CELL_BURNED);
  });

  it("never ignites nonburnable cells", () => {
    const field = new FireField(flatTerrain(), new Set([33 * 64 + 11]));
    expect(field.state[33 * 64 + 11]).toBe(CELL_NONBURNABLE);
    field.ignite([32 * 64 + 10], 0);
    for (let t = 1000; t <= 200_000; t += 1000) field.step(t, 1000, params);
    expect(field.state[33 * 64 + 11]).toBe(CELL_NONBURNABLE);
  });

  it("applies a wind shift to subsequent spread only", () => {
    const north = { ...params, windShiftMs: 100_000 };
    const eastOnly = new FireField(flatTerrain(), new Set());
    const shifted = new FireField(flatTerrain(), new Set());
    eastOnly.ignite([32 * 64 + 10], 0);
    shifted.ignite([32 * 64 + 10], 0);
    for (let t = 1000; t <= 90_000; t += 1000) {
      eastOnly.step(t, 1000, params);
      shifted.step(t, 1000, north);
    }
    expect(Array.from(shifted.state)).toEqual(Array.from(eastOnly.state));
  });

  it("finds cells within a radius by center distance", () => {
    const cells = cellsWithin(800, 800, 150);
    expect(cells.length).toBeGreaterThan(100);
    for (const c of cells) {
      const p = cellCenter(c);
      expect(Math.hypot(p.x - 800, p.y - 800)).toBeLessThanOrEqual(150);
    }
    expect(SIM_DEFAULTS.observationRadiusM).toBe(150);
  });

  it("clones independently", () => {
    const field = new FireField(flatTerrain(), new Set());
    field.ignite([500], 0);
    const copy = field.clone();
    copy.step(1000, 1000, params);
    for (let t = 1000; t <= 40_000; t += 1000) copy.step(t, 1000, params);
    expect(field.burningCount).toBe(1);
    expect(copy.burningCount).toBeGreaterThan(1);
  });
});
