import { ReplayRecording, GRID_SIZE, type ReplayTruthFrame } from "./recording.js";
import { replayLog } from "../net/replayLog.js";

/**
 * Recorded MOCK event log with truth (hand-authored, deterministic): the
 * fire spreads north-east of the briefed ignition patch far beyond what the
 * coordinator was ever told (the live mock only ever observes six cells), so
 * replay has something real to reveal. This is test data, not a simulation:
 * it only draws growing rectangles of cells and does not model spread.
 */
const IGNITION = { x0: 9, x1: 10, y0: 44, y1: 45 }; // matches scenario initialFireCells 2825/2826/2889/2890

function rect(x0: number, y0: number, x1: number, y1: number): number[] {
  const cells: number[] = [];
  for (let y = Math.max(0, y0); y <= Math.min(GRID_SIZE - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(GRID_SIZE - 1, x1); x++) cells.push(y * GRID_SIZE + x);
  }
  return cells;
}

function frame(timeMs: number, step: number): ReplayTruthFrame {
  // Active front: the outer ring of the current rectangle; everything inside it has burned out.
  const outer = rect(IGNITION.x0, IGNITION.y0 - step, IGNITION.x1 + 2 * step, IGNITION.y1);
  const inner = step === 0 ? [] : rect(IGNITION.x0, IGNITION.y0 - step + 1, IGNITION.x1 + 2 * step - 2, IGNITION.y1 - 1);
  const burnedSet = new Set(inner);
  return {
    timeMs,
    burning: outer.filter((cell) => !burnedSet.has(cell)),
    burned: [...burnedSet],
  };
}

export const mockTruthFrames: ReplayTruthFrame[] = [0, 1, 2, 3, 4, 5].map((step) => frame(step * 60_000, step));

/** Validated at the boundary like any other cross-boundary data. */
export const mockRecording: ReplayRecording = ReplayRecording.parse({
  coordinatorLog: replayLog,
  truthFrames: mockTruthFrames,
});
