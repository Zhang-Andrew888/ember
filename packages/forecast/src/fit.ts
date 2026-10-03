import type { Observation } from "@ember/domain";
import type { AgentKnowledgeSnapshot } from "@ember/knowledge";
import { SIM_DEFAULTS, cellsWithin } from "@ember/simulation/model";
import type { ForecastMember } from "./types.js";

const SIZE = SIM_DEFAULTS.gridSize;
const BURN_MS = SIM_DEFAULTS.cellBurnMs;

/** One observation, reduced to the cells whose state the observer knew at that time. */
export interface FitObservation {
  readonly id: string;
  readonly timeMs: number;
  readonly cells: Int32Array;
  /** Observed state per cell: 1 unburned, 2 burning, 3 burned. */
  readonly states: Uint8Array;
}

function stateCode(s: string): number {
  return s === "unburned" ? 1 : s === "burning" ? 2 : 3;
}

/**
 * Rebuild what each observer saw at each observation time. Sensors publish only changes, so
 * every observation's footprint also confirms that unpublished cells kept their last state.
 * Each source's observations are replayed separately in time order; cells a source never
 * reported stay unknown and are skipped rather than assumed clear.
 */
export function fitObservations(snapshot: AgentKnowledgeSnapshot): FitObservation[] {
  const bySource = new Map<string, Observation[]>();
  for (const obs of snapshot.observations) {
    const list = bySource.get(obs.sourceAgentId) ?? [];
    list.push(obs);
    bySource.set(obs.sourceAgentId, list);
  }
  const out: FitObservation[] = [];
  for (const source of [...bySource.keys()].sort()) {
    const memory = new Uint8Array(SIZE * SIZE);
    const list = (bySource.get(source) ?? []).sort((a, b) =>
      a.observedAt !== b.observedAt ? a.observedAt - b.observedAt : a.id < b.id ? -1 : 1,
    );
    for (const obs of list) {
      for (const field of obs.observedFields) {
        if (field.kind === "cell") memory[field.gridCellIndex] = stateCode(field.burnState);
      }
      const fp = obs.spatialFootprint;
      const known: number[] = [];
      for (const cell of cellsWithin(fp.centerX, fp.centerY, fp.radius)) if (memory[cell] !== 0) known.push(cell);
      if (known.length === 0) continue;
      const cells = Int32Array.from(known);
      const states = new Uint8Array(known.length);
      for (let i = 0; i < known.length; i++) states[i] = memory[known[i]!]!;
      out.push({ id: obs.id, timeMs: obs.observedAt, cells, states });
    }
  }
  return out;
}

function predicted(ign: number, t: number): number {
  if (ign > t) return 1;
  return t < ign + BURN_MS ? 2 : 3;
}

export interface FitResult {
  readonly pass: boolean;
  readonly disagreement: number;
  /** First observation the member could not explain, if any. */
  readonly failedObservationId: string | null;
}

/**
 * A member is supported when, at every observation time, at most `tolerance` of the footprint
 * disagrees and every disagreement lies within one cell of a matching predicted state.
 */
export function fitMember(
  member: ForecastMember,
  observations: readonly FitObservation[],
  tolerance: number,
  startIndex = 0,
): FitResult {
  const ign = member.ignitionMs;
  let mismatched = 0;
  let compared = 0;
  for (let oi = startIndex; oi < observations.length; oi++) {
    const o = observations[oi]!;
    let mismatches = 0;
    compared += o.cells.length;
    for (let i = 0; i < o.cells.length; i++) {
      const cell = o.cells[i]!;
      const want = o.states[i]!;
      if (predicted(ign[cell]!, o.timeMs) === want) continue;
      mismatches += 1;
      mismatched += 1;
      const gx = cell % SIZE;
      const gy = (cell - gx) / SIZE;
      let explained = false;
      for (let dy = -1; dy <= 1 && !explained; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
          if (predicted(ign[ny * SIZE + nx]!, o.timeMs) === want) {
            explained = true;
            break;
          }
        }
      }
      if (!explained) return { pass: false, disagreement: 1, failedObservationId: o.id };
    }
    if (mismatches / o.cells.length > tolerance) return { pass: false, disagreement: 1, failedObservationId: o.id };
  }
  return { pass: true, disagreement: compared === 0 ? 0 : mismatched / compared, failedObservationId: null };
}

/**
 * Incremental version of fitObservations for an append-only observation list. Falls back to a
 * full rebuild (and bumps `generation`, invalidating cached member fits) if evidence arrives
 * out of order for a source.
 */
export class FitAccumulator {
  generation = 0;
  private processed = 0;
  private list: FitObservation[] = [];
  private readonly memory = new Map<string, { mem: Uint8Array; lastAt: number }>();

  update(snapshot: AgentKnowledgeSnapshot): readonly FitObservation[] {
    const all = snapshot.observations;
    let reset = all.length < this.processed;
    for (let i = this.processed; i < all.length && !reset; i++) {
      const obs = all[i]!;
      const src = this.memory.get(obs.sourceAgentId) ?? { mem: new Uint8Array(SIZE * SIZE), lastAt: -1 };
      this.memory.set(obs.sourceAgentId, src);
      if (obs.observedAt < src.lastAt) {
        reset = true;
        break;
      }
      src.lastAt = obs.observedAt;
      for (const field of obs.observedFields) {
        if (field.kind === "cell") src.mem[field.gridCellIndex] = stateCode(field.burnState);
      }
      const fp = obs.spatialFootprint;
      const known: number[] = [];
      for (const cell of cellsWithin(fp.centerX, fp.centerY, fp.radius)) if (src.mem[cell] !== 0) known.push(cell);
      if (known.length > 0) {
        const states = new Uint8Array(known.length);
        for (let j = 0; j < known.length; j++) states[j] = src.mem[known[j]!]!;
        this.list.push({ id: obs.id, timeMs: obs.observedAt, cells: Int32Array.from(known), states });
      }
    }
    if (reset) {
      this.generation += 1;
      this.memory.clear();
      this.list = fitObservations(snapshot);
      this.processed = all.length;
      return this.list;
    }
    this.processed = all.length;
    return this.list;
  }
}
