import { describe, expect, it } from "vitest";
import { derivePrivateParameters } from "../world.js";
import { CELL_NONBURNABLE, FUEL_SHRUB, FUEL_TIMBER, FireField, SIM_DEFAULTS, crownInitiationKwM, spreadRate, unitHash, type FireParams } from "./index.js";

const N = 64 * 64;
const flat = (model: number, fuel: number) => ({
  fuel: new Float64Array(N).fill(fuel),
  height: new Float64Array(N),
  fuelModel: new Uint8Array(N).fill(model),
});
const params = (over: Partial<FireParams> = {}): FireParams => ({
  spreadMultiplier: 1.6,
  initialWindRad: 0,
  windShiftMs: Infinity,
  postShiftWindRad: 0,
  ...over,
});
const start = 32 * 64 + 10;

function run(field: FireField, p: FireParams, seconds: number): { spots: { from: number; to: number }[] } {
  const spots: { from: number; to: number }[] = [];
  for (let t = 1000; t <= seconds * 1000; t += 1000) {
    field.step(t, 1000, p);
    spots.push(...field.lastSpots);
  }
  return { spots };
}

describe("model/unitHash", () => {
  it("is deterministic, in [0, 1), and varies with each key", () => {
    expect(unitHash(1, 2, 3, 4)).toBe(unitHash(1, 2, 3, 4));
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const u = unitHash(7, i, 5, 1);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      seen.add(u);
    }
    expect(seen.size).toBe(200);
    expect(unitHash(1, 2, 3, 4)).not.toBe(unitHash(2, 2, 3, 4));
    expect(unitHash(1, 2, 3, 4)).not.toBe(unitHash(1, 2, 3, 5));
  });
});

describe("model/crown fire", () => {
  it("matches the Van Wagner threshold", () => {
    expect(crownInitiationKwM(4, 100)).toBeCloseTo(1347.5, 0);
    expect(crownInitiationKwM(8, 100)).toBeGreaterThan(crownInitiationKwM(4, 100));
  });

  it("crowns intense timber fire and speeds spread over the surface rate", () => {
    const field = new FireField(flat(FUEL_TIMBER, 1.4), new Set());
    field.ignite([start], 0);
    let east = Infinity;
    for (let t = 1000; t <= 60_000; t += 1000) {
      field.step(t, 1000, params());
      if (east === Infinity && field.state[start + 1] !== 1) east = t;
    }
    expect(field.crowned[start]).toBe(1);
    const nb = { dx: 1, dy: 0, dist: 25, ux: 1, uy: 0 };
    const surface = spreadRate(params(), 0, nb, 1.4, 0, FUEL_TIMBER);
    const crownTime = Math.ceil(25 / Math.min(surface * SIM_DEFAULTS.crownRateFactor, SIM_DEFAULTS.crownRateMax)) * 1000;
    expect(east).toBe(crownTime);
    expect(east).toBeLessThan(Math.ceil(25 / surface) * 1000);
  });

  it("never crowns fuels without a canopy, however intense", () => {
    const field = new FireField(flat(FUEL_SHRUB, 1.4), new Set());
    field.ignite([start], 0);
    for (let t = 1000; t <= 120_000; t += 1000) field.step(t, 1000, params({ spreadMultiplier: 3 }));
    expect(field.crowned.some((c) => c === 1)).toBe(false);
  });

  it("does not crown timber fire that stays below the threshold", () => {
    const field = new FireField(flat(FUEL_TIMBER, 0.6), new Set());
    field.ignite([start], 0);
    for (let t = 1000; t <= 120_000; t += 1000) field.step(t, 1000, params({ spreadMultiplier: 0.6, moisture: 0.14 }));
    expect(field.crowned.some((c) => c === 1)).toBe(false);
  });
});

describe("model/spotting", () => {
  it("does nothing without a seed", () => {
    const field = new FireField(flat(FUEL_TIMBER, 1.4), new Set());
    field.ignite([start], 0);
    expect(run(field, params(), 200).spots).toHaveLength(0);
  });

  it("lofts embers downwind past the adjacent cells under intense fire", () => {
    const field = new FireField(flat(FUEL_TIMBER, 1.4), new Set());
    field.ignite([start], 0);
    const { spots } = run(field, params({ spotSeed: 11 }), 200);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      const dx = (s.to % 64) - (s.from % 64);
      const dy = Math.floor(s.to / 64) - Math.floor(s.from / 64);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(SIM_DEFAULTS.spotMinCells);
      expect(dx).toBeGreaterThan(0); // wind blows toward +x
      expect(Math.abs(Math.atan2(dy, dx))).toBeLessThanOrEqual(SIM_DEFAULTS.spotAngleSpreadRad + 0.25);
      expect(field.ignitedAtMs[s.to]).toBeLessThan(Infinity);
    }
  });

  it("is reproducible for a seed, differs across seeds, and survives cloning", () => {
    const make = (seed: number) => {
      const f = new FireField(flat(FUEL_TIMBER, 1.4), new Set());
      f.ignite([start], 0);
      run(f, params({ spotSeed: seed }), 150);
      return f;
    };
    const a = make(5);
    const b = make(5);
    expect(Array.from(a.ignitedAtMs)).toEqual(Array.from(b.ignitedAtMs));
    expect(Array.from(make(6).ignitedAtMs)).not.toEqual(Array.from(a.ignitedAtMs));
    const clone = a.clone();
    a.step(151_000, 1000, params({ spotSeed: 5 }));
    clone.step(151_000, 1000, params({ spotSeed: 5 }));
    expect(Array.from(clone.ignitedAtMs)).toEqual(Array.from(a.ignitedAtMs));
  });

  it("never ignites nonburnable cells or cells that already burned", () => {
    const protectedCells = new Set<number>();
    for (let y = 28; y < 37; y++) for (let x = 14; x < 30; x++) protectedCells.add(y * 64 + x);
    const field = new FireField(flat(FUEL_TIMBER, 1.4), protectedCells);
    field.ignite([start], 0);
    run(field, params({ spotSeed: 3 }), 250);
    for (const c of protectedCells) {
      expect(field.state[c]).toBe(CELL_NONBURNABLE);
      expect(field.ignitedAtMs[c]).toBe(Infinity);
    }
  });

  it("is rare at ordinary intensity: gentle grass fire does not spot", () => {
    const field = new FireField(flat(0, 1), new Set());
    field.ignite([start], 0);
    expect(run(field, params({ spreadMultiplier: 1, spotSeed: 9 }), 200).spots).toHaveLength(0);
  });
});

describe("world spot seed", () => {
  it("derives a stable per-run seed independent of the other private parameters, and can be disabled", () => {
    const a = derivePrivateParameters("run-1");
    expect(a.spotSeed).toBeTypeOf("number");
    expect(derivePrivateParameters("run-1").spotSeed).toBe(a.spotSeed);
    expect(derivePrivateParameters("run-2").spotSeed).not.toBe(a.spotSeed);
    expect(derivePrivateParameters("run-1", { spreadMultiplier: 1.5 }).spotSeed).toBe(a.spotSeed);
    expect(derivePrivateParameters("run-1", { spotSeed: null }).spotSeed).toBeUndefined();
    expect(derivePrivateParameters("run-1", { spotSeed: 42 }).spotSeed).toBe(42);
  });
});
