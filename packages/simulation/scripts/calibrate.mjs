// Fast calibration check for the fire spread model. No test run needed:
//   pnpm --filter @ember/simulation build && node packages/simulation/scripts/calibrate.mjs [--set key=value ...]
// It compares the current model against the pre-Rothermel exponential model (embedded below as the
// reference) on burn area, spread-rate shape, and time for fire to reach each map node. --set overrides
// numeric SIM_DEFAULTS keys at runtime so a parameter can be swept without rebuilding.
import { FireField, RoadIndex, SIM_DEFAULTS, cellIndexOf, createTerrain, refugeCells, spreadRate } from "../dist/model/index.js";
import { buildSyntheticScenario } from "../dist/scenario.js";

const sets = process.argv.slice(2).flatMap((a, i, all) => (all[i - 1] === "--set" ? [a] : []));
for (const s of sets) {
  const [k, v] = s.split("=");
  if (!(k in SIM_DEFAULTS)) throw new Error(`unknown SIM_DEFAULTS key ${k}`);
  SIM_DEFAULTS[k] = Number(v);
}

const SIZE = SIM_DEFAULTS.gridSize;
const CELL = SIM_DEFAULTS.cellMeters;
const NB = [];
for (let dy = -1; dy <= 1; dy++)
  for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    const len = Math.hypot(dx, dy);
    NB.push({ dx, dy, dist: len * CELL, ux: dx / len, uy: dy / len });
  }

/** The exponential wind/slope model that shipped before Rothermel; the calibration target. */
class OldField {
  constructor(terrain, nonburnable) {
    this.t = terrain;
    this.state = new Uint8Array(SIZE * SIZE).fill(1);
    this.ign = new Float64Array(SIZE * SIZE).fill(Infinity);
    this.prog = new Float64Array(SIZE * SIZE * 8);
    this.burning = [];
    for (const c of nonburnable) this.state[c] = 0;
  }
  ignite(cells, t) {
    for (const c of cells) if (this.state[c] === 1) { this.state[c] = 2; this.ign[c] = t; this.burning.push(c); }
  }
  step(to, dtMs, p) {
    this.burning = this.burning.filter((c) => (to - this.ign[c] >= SIM_DEFAULTS.cellBurnMs ? ((this.state[c] = 3), false) : true));
    const wind = to >= p.windShiftMs ? p.postShiftWindRad : p.initialWindRad;
    const reached = new Set();
    for (const c of this.burning) {
      const gx = c % SIZE, gy = (c - gx) / SIZE;
      NB.forEach((nb, d) => {
        const nx = gx + nb.dx, ny = gy + nb.dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) return;
        const tg = ny * SIZE + nx;
        if (this.state[tg] !== 1) return;
        const slope = Math.max(-0.5, Math.min(0.5, (this.t.height[tg] - this.t.height[c]) / nb.dist));
        const align = Math.cos(wind) * nb.ux + Math.sin(wind) * nb.uy;
        const raw = 0.5 * p.spreadMultiplier * this.t.fuel[tg] * Math.exp(0.6 * align + 1.5 * slope);
        this.prog[c * 8 + d] += Math.max(0.1, Math.min(2, raw)) * (dtMs / 1000);
        if (this.prog[c * 8 + d] >= nb.dist) reached.add(tg);
      });
    }
    for (const tg of reached) { this.state[tg] = 2; this.ign[tg] = to; this.burning.push(tg); }
  }
}

const scenario = buildSyntheticScenario();
const road = new RoadIndex(scenario.map);
const terrain = createTerrain(scenario.map.terrainSeed);
const nonburnable = refugeCells(road, SIM_DEFAULTS.refugeRadiusM);
const count = (f) => f.ign.filter((x) => x < Infinity).length;
const countNew = (f) => f.ignitedAtMs.filter((x) => x < Infinity).length;

function run(mult, shiftMs, horizonMs) {
  const p = { spreadMultiplier: mult, initialWindRad: 0, windShiftMs: shiftMs, postShiftWindRad: 1.2 };
  const a = new FireField(terrain, nonburnable);
  const b = new OldField(terrain, nonburnable);
  a.ignite(scenario.map.initialFireCells, 0);
  b.ignite(scenario.map.initialFireCells, 0);
  const area = [];
  for (let t = 1000; t <= horizonMs; t += 1000) {
    a.step(t, 1000, p);
    b.step(t, 1000, p);
    if (t % 150_000 === 0) area.push([t / 1000, countNew(a), count(b)]);
  }
  return { a, b, area };
}

console.log("== burn area (cells ignited): new/old ratio at 150/300/450/600 s");
let worst = 0;
for (const mult of [0.6, 1, 1.6])
  for (const shift of [250_000, 650_000]) {
    const { area } = run(mult, shift, 600_000);
    const ratios = area.map(([, n, o]) => n / o);
    worst = Math.max(worst, ...ratios.map((r) => Math.abs(r - 1)));
    console.log(`mult ${mult} shift ${shift / 1000}s:`, area.map(([t, n, o]) => `${t}s ${n}/${o}=${(n / o).toFixed(2)}`).join("  "));
  }
console.log(`worst area deviation from old model: ${(worst * 100).toFixed(0)}%`);

console.log("\n== shrub flat rate by heading from wind (mult 1), m/s: new vs old");
const p1 = { spreadMultiplier: 1, initialWindRad: 0, windShiftMs: Infinity, postShiftWindRad: 0 };
for (const deg of [0, 45, 90, 135, 180]) {
  const th = (deg * Math.PI) / 180;
  const nb = { dist: 25, ux: Math.cos(th), uy: Math.sin(th) };
  const oldRate = Math.max(0.1, Math.min(2, 0.5 * Math.exp(0.6 * Math.cos(th))));
  console.log(`${String(deg).padStart(3)} deg  new ${spreadRate(p1, 0, nb, 1, 0).toFixed(3)}  old ${oldRate.toFixed(3)}`);
}

console.log("\n== first ignition time (s) of each map node cell, mult 1, 900 s: new vs old");
const { a, b } = run(1, 650_000, 900_000);
const rows = [];
for (const n of scenario.map.nodes) {
  const c = cellIndexOf(n.x, n.y);
  const f = (x) => (x === Infinity ? "-" : Math.round(x / 1000));
  rows.push(`${n.id}: ${f(a.ignitedAtMs[c])}/${f(b.ign[c])}`);
}
console.log(rows.join("  "));

console.log("\n== spotting and crown fire on the default scenario (seed 1), 900 s");
for (const mult of [1, 1.6]) {
  const p = { spreadMultiplier: mult, initialWindRad: 0, windShiftMs: 650_000, postShiftWindRad: 1.2, spotSeed: 1 };
  const f = new FireField(terrain, nonburnable);
  f.ignite(scenario.map.initialFireCells, 0);
  let spots = 0;
  let worstMs = 0;
  const t0 = performance.now();
  for (let t = 1000; t <= 900_000; t += 1000) {
    const s0 = performance.now();
    f.step(t, 1000, p);
    worstMs = Math.max(worstMs, performance.now() - s0);
    spots += f.lastSpots.length;
  }
  const crowned = f.crowned.filter((c) => c === 1).length;
  console.log(`mult ${mult}: spots ${spots}, cells that crowned ${crowned}, ignited ${countNew(f)}, avg step ${((performance.now() - t0) / 900).toFixed(3)} ms, worst step ${worstMs.toFixed(2)} ms`);
}
