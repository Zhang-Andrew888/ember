import { describe, expect, it, vi } from "vitest";
import type { NodeId } from "@ember/domain";
import { SIM_DEFAULTS, World, buildSyntheticScenario, derivePrivateParameters } from "./index.js";
import { CELL_BURNED, CELL_BURNING, CELL_NONBURNABLE, CELL_UNBURNED, RoadIndex, cellIndexOf } from "./model/index.js";

/**
 * Phase 0 feasibility check for crew-built firebreaks: hand-placed lines of nonburnable cells,
 * completed one cell at a time, with no agents in the world. No production code is involved; the
 * test writes `FireField.state` directly, the way refuge cells are marked at construction.
 */

vi.setConfig({ testTimeout: 120_000 });

const N = SIM_DEFAULTS.gridSize;
const SEEDS = ["showcase", "dev-1", "dev-2", "dev-3", "dev-4", "golden-1", "held-a", "held-b", "held-c", "held-d"];
const scenario = buildSyntheticScenario();
const road = new RoadIndex(scenario.map);
const RIDGE_CABINS = 0;

interface Outcome {
  readonly burned: number;
  readonly burning: number;
  readonly damage: readonly number[];
  /** Fraction of line cells that were still unburned when their work finished. */
  readonly intact: number;
}

/** Run the whole horizon; line cell i becomes nonburnable at startMs + (i + 1) * perCellMs if still unburned. */
function run(seed: string, line: readonly number[] = [], startMs = 0, perCellMs = 0): Outcome {
  const w = new World(scenario, derivePrivateParameters(seed));
  let next = 0;
  let held = 0;
  while (w.timeMs < SIM_DEFAULTS.incidentHorizonMs) {
    while (next < line.length && startMs + (next + 1) * perCellMs <= w.timeMs) {
      const cell = line[next]!;
      if (w.fire.state[cell] === CELL_UNBURNED) {
        w.fire.state[cell] = CELL_NONBURNABLE;
        held++;
      }
      next++;
    }
    w.step();
  }
  let burned = 0;
  for (const s of w.fire.state) if (s === CELL_BURNED || s === CELL_BURNING) burned++;
  return { burned, burning: w.fire.burningCount, damage: w.sites.map((s) => s.damage), intact: line.length === 0 ? 1 : held / line.length };
}

function column(gx: number, gy0: number, gy1: number): number[] {
  const out: number[] = [];
  for (let gy = gy0; gy <= gy1; gy++) out.push(gy * N + gx);
  return out;
}

/** Chebyshev ring around a node's cell, west (fire-facing) side first. */
function ring(node: string, r: number): number[] {
  const p = road.nodePoint(node as NodeId);
  const c = cellIndexOf(p.x, p.y)!;
  const cx = c % N;
  const cy = (c - cx) / N;
  const out: number[] = [];
  for (let gy = cy - r; gy <= cy + r; gy++) {
    for (let gx = cx - r; gx <= cx + r; gx++) {
      if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) === r) out.push(gy * N + gx);
    }
  }
  return out.sort((a, b) => (a % N) - (b % N) || a - b);
}

/** Insert an orthogonal cell between diagonal neighbours so an 8-neighbour spread cannot slip through. */
function fourConnected(cells: readonly number[]): number[] {
  const out: number[] = [];
  for (const c of cells) {
    const prev = out[out.length - 1];
    if (prev !== undefined) {
      const px = prev % N;
      const cx = c % N;
      const py = (prev - px) / N;
      const cy = (c - cx) / N;
      if (Math.abs(px - cx) === 1 && Math.abs(py - cy) === 1) out.push(py * N + cx);
    }
    out.push(c);
  }
  return out;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;

describe("hand-placed firebreak feasibility (synthetic scenario)", () => {
  const baseline = new Map(SEEDS.map((s) => [s, run(s)]));
  const baseBurned = mean(SEEDS.map((s) => baseline.get(s)!.burned));
  const ridgeHit = SEEDS.filter((s) => baseline.get(s)!.damage[RIDGE_CABINS]! > 0);

  it("baseline: the fire reaches Ridge Cabins in most seeds, late in the horizon", () => {
    expect(ridgeHit.length).toBeGreaterThanOrEqual(5);
  });

  // 40 cells at x = 1000-1025 m from below the fire's southern extent to the top map edge, which
  // anchors it; n-h sits on the line, so crews can reach it by road.
  const headLine = column(40, 24, 63);

  it("an anchored line across the head, finished by 500 s, cuts burned area and saves Ridge Cabins", () => {
    // Three crews at 15 s of work per cell, starting at 300 s.
    const runs = SEEDS.map((s) => run(s, headLine, 300_000, 5_000));
    expect(mean(runs.map((r) => r.burned))).toBeLessThan(baseBurned * 0.85);
    // Baseline damage is 0.32-1.0 in these seeds; at most a brush (dev-2: 0.012) remains.
    for (const s of ridgeHit) expect(run(s, headLine, 300_000, 5_000).damage[RIDGE_CABINS]).toBeLessThan(0.05);
    // The fire is shaped, not contained: something is still burning at the horizon in every seed.
    for (const r of runs) expect(r.burning).toBeGreaterThan(0);
  });

  it("the same line at today's containment cost (45 s per cell, one crew) is overrun before it closes", () => {
    const runs = SEEDS.map((s) => run(s, headLine, 300_000, SIM_DEFAULTS.containmentWorkRequired * 1000));
    expect(mean(runs.map((r) => r.intact))).toBeLessThan(0.6);
    expect(mean(runs.map((r) => r.burned))).toBeGreaterThan(baseBurned * 0.95);
  });

  it("a 16-cell ring keeps Ridge Cabins untouched even when finished at 840 s", () => {
    const cells = ring("n-sa", 2);
    expect(cells).toHaveLength(16);
    for (const s of SEEDS) expect(run(s, cells, 600_000, 15_000).damage[RIDGE_CABINS]).toBe(0);
  });

  it("line cells must share edges: a diagonal-only line leaks", () => {
    const diagonal: number[] = [];
    for (let i = 0; i < 40; i++) diagonal.push((24 + i) * N + 20 + i);
    const stair = fourConnected(diagonal);
    const leaky = mean(SEEDS.map((s) => run(s, diagonal).burned));
    const sealed = mean(SEEDS.map((s) => run(s, stair).burned));
    expect(leaky).toBeGreaterThan(baseBurned * 0.95);
    expect(sealed).toBeLessThan(baseBurned * 0.85);
  });
});
