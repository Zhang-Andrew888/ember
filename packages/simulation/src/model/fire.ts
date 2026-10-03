import { SIM_DEFAULTS } from "./constants.js";
import {
  FUEL_MODELS,
  FUEL_SHRUB,
  ellipseEccentricity,
  firelineIntensityKwM,
  ellipseFactor,
  noWindRateFtMin,
  rothermelPhiS,
  rothermelPhiW,
} from "./rothermel.js";
import type { Terrain } from "./terrain.js";

/** Cell burn states. Nonburnable cells never ignite (refuge protection areas). */
export const CELL_NONBURNABLE = 0;
export const CELL_UNBURNED = 1;
export const CELL_BURNING = 2;
export const CELL_BURNED = 3;
export type CellState = 0 | 1 | 2 | 3;

export interface FireParams {
  readonly spreadMultiplier: number;
  /** Direction the fire is pushed toward, radians counterclockwise from east. */
  readonly initialWindRad: number;
  readonly windShiftMs: number;
  readonly postShiftWindRad: number;
  /** Fraction (0..1) of cell distance already accumulated from the initial front. */
  readonly initialProgress?: number;
  /** Effective midflame wind speed in m/s; defaults to SIM_DEFAULTS.windSpeedMps. */
  readonly windSpeedMps?: number;
  /** Dead fuel moisture fraction; defaults to SIM_DEFAULTS.fuelMoisture. */
  readonly moisture?: number;
}

export function windDirectionAt(params: FireParams, tMs: number): number {
  return tMs >= params.windShiftMs ? params.postShiftWindRad : params.initialWindRad;
}

const SIZE = SIM_DEFAULTS.gridSize;
const CELL = SIM_DEFAULTS.cellMeters;

interface Neighbor {
  readonly dx: number;
  readonly dy: number;
  readonly dist: number;
  readonly ux: number;
  readonly uy: number;
}

const NEIGHBORS: readonly Neighbor[] = (() => {
  const out: Neighbor[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const len = Math.hypot(dx, dy);
      out.push({ dx, dy, dist: len * CELL, ux: dx / len, uy: dy / len });
    }
  }
  return out;
})();

const REFERENCE_R0 = noWindRateFtMin(FUEL_MODELS[FUEL_SHRUB]!, SIM_DEFAULTS.fuelMoisture);

/** Rothermel R0 relative to the reference fuel and moisture, so baseSpreadRate keeps its documented meaning. */
export function relativeNoWindRate(model: number, moisture: number): number {
  return noWindRateFtMin(FUEL_MODELS[model]!, moisture) / REFERENCE_R0;
}

/**
 * Scale from the Rothermel rate to game meters per second. It is derived, not hand-set: the reference
 * head fire (shrub, reference moisture, effective wind, flat, multiplier 1) must run at
 * SIM_DEFAULTS.referenceHeadRateMps. The head ellipse factor is 1, so that rate is
 * baseSpreadRate * gain * (1 + phi_w).
 */
export function rothermelGain(): number {
  const phiW = rothermelPhiW(FUEL_MODELS[FUEL_SHRUB]!, SIM_DEFAULTS.windSpeedMps);
  return SIM_DEFAULTS.referenceHeadRateMps / (SIM_DEFAULTS.baseSpreadRate * (1 + phiW));
}

export function spreadRate(
  params: FireParams,
  windRad: number,
  neighbor: Neighbor,
  targetFuel: number,
  rise: number,
  model: number = FUEL_SHRUB,
): number {
  const fm = FUEL_MODELS[model]!;
  const windMps = params.windSpeedMps ?? SIM_DEFAULTS.windSpeedMps;
  const moisture = params.moisture ?? SIM_DEFAULTS.fuelMoisture;
  const cosTheta = Math.cos(windRad) * neighbor.ux + Math.sin(windRad) * neighbor.uy;
  const run = neighbor.dist;
  const slope = Math.max(-SIM_DEFAULTS.slopeClamp, Math.min(SIM_DEFAULTS.slopeClamp, rise / run));
  const wind = ellipseFactor(ellipseEccentricity(windMps, SIM_DEFAULTS.ellipseWindFactor), cosTheta) * (1 + rothermelPhiW(fm, windMps));
  const raw =
    SIM_DEFAULTS.baseSpreadRate *
    rothermelGain() *
    params.spreadMultiplier *
    targetFuel *
    relativeNoWindRate(model, moisture) *
    (wind + rothermelPhiS(fm, slope));
  const [lo, hi] = SIM_DEFAULTS.spreadRateClamp;
  return Math.max(lo, Math.min(hi, raw));
}

interface StaticFactors {
  /** Public fuel-continuity multiplier of the target cell, per cell and direction. */
  readonly fuelMul: Float64Array;
  /** Rothermel slope coefficient phi_s of the target cell's fuel model, per cell and direction. */
  readonly slopePhi: Float64Array;
}

const staticCache = new WeakMap<Terrain, StaticFactors>();

/** The parts of the spread rate that never change in a run: target fuel and the uphill slope term. */
function staticFactors(terrain: Terrain): StaticFactors {
  const hit = staticCache.get(terrain);
  if (hit !== undefined) return hit;
  const fuelMul = new Float64Array(SIZE * SIZE * 8);
  const slopePhi = new Float64Array(SIZE * SIZE * 8);
  for (let cell = 0; cell < SIZE * SIZE; cell++) {
    const gx = cell % SIZE;
    const gy = (cell - gx) / SIZE;
    for (let d = 0; d < 8; d++) {
      const nb = NEIGHBORS[d]!;
      const nx = gx + nb.dx;
      const ny = gy + nb.dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const target = ny * SIZE + nx;
      const slope = Math.max(-SIM_DEFAULTS.slopeClamp, Math.min(SIM_DEFAULTS.slopeClamp, (terrain.height[target]! - terrain.height[cell]!) / nb.dist));
      fuelMul[cell * 8 + d] = terrain.fuel[target]!;
      slopePhi[cell * 8 + d] = rothermelPhiS(FUEL_MODELS[terrain.fuelModel[target]!]!, slope);
    }
  }
  const out = { fuelMul, slopePhi };
  staticCache.set(terrain, out);
  return out;
}

/**
 * Grid fire state advanced one fixed step at a time. The authoritative simulator and the
 * forecast ensembles both use this class so they share one spread mechanism.
 */
export class FireField {
  readonly state: Uint8Array;
  /** Ignition time per cell in ms; Infinity if the cell has not ignited. */
  readonly ignitedAtMs: Float64Array;
  private readonly progress: Float64Array;
  private burning: number[] = [];
  private readonly terrain: Terrain;

  constructor(terrain: Terrain, nonburnable: ReadonlySet<number>) {
    const n = SIZE * SIZE;
    this.terrain = terrain;
    this.state = new Uint8Array(n).fill(CELL_UNBURNED);
    this.ignitedAtMs = new Float64Array(n).fill(Infinity);
    this.progress = new Float64Array(n * 8);
    for (const cell of nonburnable) this.state[cell] = CELL_NONBURNABLE;
  }

  get burningCells(): readonly number[] {
    return this.burning;
  }

  get burningCount(): number {
    return this.burning.length;
  }

  /** Ignite cells at time tMs. Already burning/burned/nonburnable cells are skipped. */
  ignite(cells: readonly number[], tMs: number, initialProgress = 0): void {
    for (const cell of cells) {
      if (this.state[cell] !== CELL_UNBURNED) continue;
      this.state[cell] = CELL_BURNING;
      this.ignitedAtMs[cell] = tMs;
      this.burning.push(cell);
    }
    if (initialProgress > 0) {
      for (const cell of cells) {
        for (let d = 0; d < 8; d++) this.progress[cell * 8 + d] = initialProgress * NEIGHBORS[d]!.dist;
      }
    }
  }

  /**
   * Advance to toMs. Burn timers expire first, then burning cells accumulate spread
   * progress toward unburned neighbors, then newly reached cells ignite at toMs.
   * Returns the cells that ignited this step, in deterministic order.
   */
  step(toMs: number, dtMs: number, params: FireParams): number[] {
    const survivors: number[] = [];
    for (const cell of this.burning) {
      if (toMs - this.ignitedAtMs[cell]! >= SIM_DEFAULTS.cellBurnMs) this.state[cell] = CELL_BURNED;
      else survivors.push(cell);
    }
    this.burning = survivors;

    const wind = windDirectionAt(params, toMs);
    const dtSec = dtMs / 1000;
    const stat = staticFactors(this.terrain);
    const baseRate = SIM_DEFAULTS.baseSpreadRate * rothermelGain() * params.spreadMultiplier;
    const [rateLo, rateHi] = SIM_DEFAULTS.spreadRateClamp;
    const windMps = params.windSpeedMps ?? SIM_DEFAULTS.windSpeedMps;
    const moisture = params.moisture ?? SIM_DEFAULTS.fuelMoisture;
    const ecc = ellipseEccentricity(windMps, SIM_DEFAULTS.ellipseWindFactor);
    // Per fuel model: relative R0 and per direction (1 + phi_w) times the ellipse factor.
    const modelCount = FUEL_MODELS.length;
    const r0Rel = new Float64Array(modelCount);
    const windTerm = new Float64Array(modelCount * 8);
    for (let m = 0; m < modelCount; m++) {
      r0Rel[m] = relativeNoWindRate(m, moisture);
      const phiW = rothermelPhiW(FUEL_MODELS[m]!, windMps);
      for (let d = 0; d < 8; d++) {
        const nb = NEIGHBORS[d]!;
        windTerm[m * 8 + d] = ellipseFactor(ecc, Math.cos(wind) * nb.ux + Math.sin(wind) * nb.uy) * (1 + phiW);
      }
    }
    const modelOf = this.terrain.fuelModel;
    const reached: number[] = [];
    const seen = new Set<number>();
    for (const cell of this.burning) {
      const gx = cell % SIZE;
      const gy = (cell - gx) / SIZE;
      for (let d = 0; d < 8; d++) {
        const nb = NEIGHBORS[d]!;
        const nx = gx + nb.dx;
        const ny = gy + nb.dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const target = ny * SIZE + nx;
        if (this.state[target] !== CELL_UNBURNED) continue;
        const slot = cell * 8 + d;
        const m = modelOf[target]!;
        const raw = baseRate * stat.fuelMul[slot]! * r0Rel[m]! * (windTerm[m * 8 + d]! + stat.slopePhi[slot]!);
        const rate = raw < rateLo ? rateLo : raw > rateHi ? rateHi : raw;
        const next = this.progress[slot]! + rate * dtSec;
        this.progress[slot] = next;
        if (next >= nb.dist && !seen.has(target)) {
          seen.add(target);
          reached.push(target);
        }
      }
    }
    for (const target of reached) {
      this.state[target] = CELL_BURNING;
      this.ignitedAtMs[target] = toMs;
      this.burning.push(target);
    }
    return reached;
  }

  /**
   * Head-fire fireline intensity in kW/m at a cell: the wind-aligned flat-ground spread rate through the
   * same game spread function, with the cell's own fuel. Game-scale; used by crown fire and spotting rules.
   */
  headIntensityKwM(cell: number, params: FireParams, tMs: number): number {
    const wind = windDirectionAt(params, tMs);
    const head: Neighbor = { dx: 1, dy: 0, dist: CELL, ux: Math.cos(wind), uy: Math.sin(wind) };
    const model = this.terrain.fuelModel[cell]!;
    const rate = spreadRate(params, wind, head, this.terrain.fuel[cell]!, 0, model);
    return firelineIntensityKwM(FUEL_MODELS[model]!, params.moisture ?? SIM_DEFAULTS.fuelMoisture, rate);
  }

  clone(): FireField {
    const copy = new FireField(this.terrain, new Set());
    copy.state.set(this.state);
    copy.ignitedAtMs.set(this.ignitedAtMs);
    copy.progress.set(this.progress);
    copy.burning = [...this.burning];
    return copy;
  }
}

/** Cells within `radiusM` of a point, by cell-center distance. */
export function cellsWithin(x: number, y: number, radiusM: number): number[] {
  const out: number[] = [];
  const reach = Math.ceil(radiusM / CELL) + 1;
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  for (let gy = Math.max(0, cy - reach); gy <= Math.min(SIZE - 1, cy + reach); gy++) {
    for (let gx = Math.max(0, cx - reach); gx <= Math.min(SIZE - 1, cx + reach); gx++) {
      const px = (gx + 0.5) * CELL;
      const py = (gy + 0.5) * CELL;
      if (Math.hypot(px - x, py - y) <= radiusM) out.push(gy * SIZE + gx);
    }
  }
  return out;
}
