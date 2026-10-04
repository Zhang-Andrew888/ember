import { SIM_DEFAULTS } from "./constants.js";
import type { Terrain } from "./terrain.js";

/** Cell burn states. Nonburnable cells never ignite (refuge protection areas and finished firebreaks). */
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

export function spreadRate(
  params: FireParams,
  windRad: number,
  neighbor: Neighbor,
  targetFuel: number,
  rise: number,
): number {
  const alignment = Math.cos(windRad) * neighbor.ux + Math.sin(windRad) * neighbor.uy;
  const run = neighbor.dist;
  const slope = Math.max(-SIM_DEFAULTS.slopeClamp, Math.min(SIM_DEFAULTS.slopeClamp, rise / run));
  const raw =
    SIM_DEFAULTS.baseSpreadRate *
    params.spreadMultiplier *
    targetFuel *
    Math.exp(SIM_DEFAULTS.windCoefficient * alignment + SIM_DEFAULTS.slopeCoefficient * slope);
  const [lo, hi] = SIM_DEFAULTS.spreadRateClamp;
  return Math.max(lo, Math.min(hi, raw));
}

const staticCache = new WeakMap<Terrain, Float64Array>();

/**
 * The part of the spread rate that never changes in a run: target fuel times the uphill slope
 * term, per cell and direction. Splitting it out turns the per-step work into multiplications.
 */
function staticFactors(terrain: Terrain): Float64Array {
  const hit = staticCache.get(terrain);
  if (hit !== undefined) return hit;
  const out = new Float64Array(SIZE * SIZE * 8);
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
      out[cell * 8 + d] = terrain.fuel[target]! * Math.exp(SIM_DEFAULTS.slopeCoefficient * slope);
    }
  }
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
  /** Accumulated suppression work per cell (structure protection does not touch this). */
  private readonly containmentWork: Float64Array;
  /**
   * Fraction of each cell's fuel cleared, 0..1. Spread into a cell keeps (1 - clearance) of its rate,
   * and a diagonal step between two cleared corner cells keeps (1 - the smaller clearance), so a line
   * whose cells only touch at corners still holds. A fully cleared cell is nonburnable.
   */
  readonly clearance: Float64Array;
  private burning: number[] = [];
  private readonly terrain: Terrain;

  /** `cleared` cells are firebreaks: nonburnable and fully cleared, so they also block corner gaps. */
  constructor(terrain: Terrain, nonburnable: ReadonlySet<number>, cleared: ReadonlySet<number> = new Set()) {
    const n = SIZE * SIZE;
    this.terrain = terrain;
    this.state = new Uint8Array(n).fill(CELL_UNBURNED);
    this.ignitedAtMs = new Float64Array(n).fill(Infinity);
    this.progress = new Float64Array(n * 8);
    this.containmentWork = new Float64Array(n);
    this.clearance = new Float64Array(n);
    for (const cell of nonburnable) this.state[cell] = CELL_NONBURNABLE;
    for (const cell of cleared) {
      this.state[cell] = CELL_NONBURNABLE;
      this.clearance[cell] = 1;
    }
  }

  /**
   * Clear `fraction` more of an unburned cell's fuel. Burning, burned and nonburnable cells cannot be
   * cleared. Returns "completed" when the cell becomes a firebreak on this call.
   */
  applyClearance(cell: number, fraction: number): "none" | "progress" | "completed" {
    if (this.state[cell] !== CELL_UNBURNED || fraction <= 0) return "none";
    // Tolerance: a cell cleared in n equal steps of 1/n must finish despite rounding.
    const after = this.clearance[cell]! + fraction;
    if (after < 1 - 1e-9) {
      this.clearance[cell] = after;
      return "progress";
    }
    this.clearance[cell] = 1;
    this.state[cell] = CELL_NONBURNABLE;
    return "completed";
  }

  /** Fraction in [0,1] of spread rate retained from this burning cell (0 = fully restrained). */
  spreadFactorFrom(cell: number): number {
    if (this.state[cell] !== CELL_BURNING) return 1;
    const required = SIM_DEFAULTS.containmentWorkRequired;
    const done = this.containmentWork[cell]!;
    if (done >= required) return 0;
    return 1 - done / required;
  }

  /** Apply crew suppression work at a cell that is still burning. Returns true when newly fully restrained. */
  applyContainmentWork(cell: number, units: number): boolean {
    if (this.state[cell] !== CELL_BURNING || units <= 0) return false;
    const before = this.containmentWork[cell]!;
    const after = Math.min(SIM_DEFAULTS.containmentWorkRequired, before + units);
    this.containmentWork[cell] = after;
    return before < SIM_DEFAULTS.containmentWorkRequired && after >= SIM_DEFAULTS.containmentWorkRequired;
  }

  /**
   * Extinguish a burning cell: burned fuel, no spread until/unless ignited again.
   * Used when crews complete line suppression at the fire edge.
   */
  extinguishCell(cell: number): void {
    if (this.state[cell] !== CELL_BURNING) return;
    this.state[cell] = CELL_BURNED;
    this.containmentWork[cell] = SIM_DEFAULTS.containmentWorkRequired;
    this.burning = this.burning.filter((c) => c !== cell);
    for (let d = 0; d < 8; d++) this.progress[cell * 8 + d] = 0;
  }

  totalIgnitionsRecorded = 0;

  /** Cells that ever ignited (for deterministic spread comparisons in tests). */
  ignitionCount(): number {
    return this.totalIgnitionsRecorded;
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
      this.totalIgnitionsRecorded += 1;
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
    const baseRate = SIM_DEFAULTS.baseSpreadRate * params.spreadMultiplier;
    const [rateLo, rateHi] = SIM_DEFAULTS.spreadRateClamp;
    const windFactor = new Float64Array(8);
    for (let d = 0; d < 8; d++) {
      const nb = NEIGHBORS[d]!;
      windFactor[d] = Math.exp(SIM_DEFAULTS.windCoefficient * (Math.cos(wind) * nb.ux + Math.sin(wind) * nb.uy));
    }
    const reached: number[] = [];
    const seen = new Set<number>();
    const clear = this.clearance;
    for (const cell of this.burning) {
      const spreadScale = this.spreadFactorFrom(cell);
      if (spreadScale <= 0) continue;
      const gx = cell % SIZE;
      const gy = (cell - gx) / SIZE;
      for (let d = 0; d < 8; d++) {
        const nb = NEIGHBORS[d]!;
        const nx = gx + nb.dx;
        const ny = gy + nb.dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const target = ny * SIZE + nx;
        if (this.state[target] !== CELL_UNBURNED) continue;
        // Cleared fuel scales the clamped rate, so clearing can take spread below the clamp floor.
        let fuelLeft = 1 - clear[target]!;
        if (nb.dx !== 0 && nb.dy !== 0) fuelLeft *= 1 - Math.min(clear[gy * SIZE + nx]!, clear[ny * SIZE + gx]!);
        if (fuelLeft <= 0) continue;
        const slot = cell * 8 + d;
        const raw = baseRate * stat[slot]! * windFactor[d]! * spreadScale;
        const rate = (raw < rateLo ? rateLo : raw > rateHi ? rateHi : raw) * fuelLeft;
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
      this.totalIgnitionsRecorded += 1;
    }
    return reached;
  }

  clone(): FireField {
    const copy = new FireField(this.terrain, new Set());
    copy.state.set(this.state);
    copy.ignitedAtMs.set(this.ignitedAtMs);
    copy.progress.set(this.progress);
    copy.containmentWork.set(this.containmentWork);
    copy.clearance.set(this.clearance);
    copy.burning = [...this.burning];
    copy.totalIgnitionsRecorded = this.totalIgnitionsRecorded;
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
