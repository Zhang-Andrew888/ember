import type { Observation } from "@ember/domain";
import type { AgentKnowledgeSnapshot } from "@ember/knowledge";
import { GRID_EDGE } from "@ember/knowledge";
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
        if (field.kind === "cell" && field.edgeId === GRID_EDGE) memory[field.cellIndex] = stateCode(field.burnState);
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
  /** First observation the member could not explain, if any. */
  readonly failedObservationId: string | null;
}

/**
 * A member is supported when, at every observation time, at most `tolerance` of the footprint
 * disagrees and every disagreement lies within one cell of a matching predicted state.
 */
export function fitMember(member: ForecastMember, observations: readonly FitObservation[], tolerance: number): FitResult {
  const ign = member.ignitionMs;
  for (const o of observations) {
    let mismatches = 0;
    for (let i = 0; i < o.cells.length; i++) {
      const cell = o.cells[i]!;
      const want = o.states[i]!;
      if (predicted(ign[cell]!, o.timeMs) === want) continue;
      mismatches += 1;
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
      if (!explained) return { pass: false, failedObservationId: o.id };
    }
    if (mismatches / o.cells.length > tolerance) return { pass: false, failedObservationId: o.id };
  }
  return { pass: true, failedObservationId: null };
}
