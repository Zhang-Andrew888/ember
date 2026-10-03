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
  type Terrain,
  rothermelPhiW,
  FUEL_MODELS,
  FUEL_SHRUB,
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
  fuelModel: new Uint8Array(64 * 64).fill(1),
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
    expect(down).toBeCloseTo(0.5 * SIM_DEFAULTS.rothermelGain * (1 + rothermelPhiW(FUEL_MODELS[FUEL_SHRUB]!, SIM_DEFAULTS.windSpeedMps)), 6);
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
    // 25 m at 0.5 * 1.35 * (1 + phi_w) m/s is about 22.9 s, so ignition lands on step 23.
    expect(ignitedEast).toBe(23_000);
    expect(field.ignitedAtMs[start + 1]).toBe(23_000);
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

describe("model/fire fast path", () => {
  /** Reference implementation straight from the documented formula, one exp() per cell and direction. */
  function referenceIgnitions(terrain: Terrain, p: FireParams, steps: number): Float64Array {
    const SIZE = 64;
    const state = new Uint8Array(SIZE * SIZE).fill(CELL_UNBURNED);
    const ign = new Float64Array(SIZE * SIZE).fill(Infinity);
    const progress = new Float64Array(SIZE * SIZE * 8);
    let burning: number[] = [];
    const start = 32 * SIZE + 20;
    state[start] = CELL_BURNING;
    ign[start] = 0;
    burning = [start];
    const dirs: { dx: number; dy: number; dist: number; ux: number; uy: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const len = Math.hypot(dx, dy);
        dirs.push({ dx, dy, dist: len * 25, ux: dx / len, uy: dy / len });
      }
    }
    for (let s = 1; s <= steps; s++) {
      const t = s * 1000;
      burning = burning.filter((c) => {
        if (t - ign[c]! >= SIM_DEFAULTS.cellBurnMs) {
          state[c] = CELL_BURNED;
          return false;
        }
        return true;
      });
      const wind = t >= p.windShiftMs ? p.postShiftWindRad : p.initialWindRad;
      const reached: number[] = [];
      for (const c of burning) {
        const gx = c % SIZE;
        const gy = (c - gx) / SIZE;
        dirs.forEach((d, i) => {
          const nx = gx + d.dx;
          const ny = gy + d.dy;
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) return;
          const target = ny * SIZE + nx;
          if (state[target] !== CELL_UNBURNED) return;
          const rate = spreadRate(p, wind, d, terrain.fuel[target]!, terrain.height[target]! - terrain.height[c]!, terrain.fuelModel[target]!);
          progress[c * 8 + i] = progress[c * 8 + i]! + rate;
          if (progress[c * 8 + i]! >= d.dist && !reached.includes(target)) reached.push(target);
        });
      }
      for (const target of reached) {
        state[target] = CELL_BURNING;
        ign[target] = t;
        burning.push(target);
      }
    }
    return ign;
  }

  it("matches the documented per-cell formula for varied terrain, rates and wind shifts", () => {
    const cases: FireParams[] = [
      { spreadMultiplier: 1, initialWindRad: 0, windShiftMs: 1e9, postShiftWindRad: 0 },
      { spreadMultiplier: 0.6, initialWindRad: 0.2, windShiftMs: 90_000, postShiftWindRad: 1.4 },
      { spreadMultiplier: 1.6, initialWindRad: -0.25, windShiftMs: 60_000, postShiftWindRad: 1.75 },
    ];
    for (const [i, p] of cases.entries()) {
      const terrain = createTerrain(`ref-${i}`);
      const field = new FireField(terrain, new Set());
      field.ignite([32 * 64 + 20], 0);
      for (let t = 1000; t <= 200_000; t += 1000) field.step(t, 1000, p);
      const ref = referenceIgnitions(terrain, p, 200);
      let different = 0;
      for (let c = 0; c < ref.length; c++) if (ref[c] !== field.ignitedAtMs[c]) different += 1;
      // Floating-point association differs (exp(a)exp(b) vs exp(a+b)); allow only rare one-step ties.
      expect(different).toBeLessThanOrEqual(3);
      expect(field.burningCount + 1).toBeGreaterThan(10);
    }
  });
});
