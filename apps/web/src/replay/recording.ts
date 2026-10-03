import { z } from "zod";
import { CoordinatorView } from "@ember/domain";
import type { FireCellMarker } from "../components/scene/sceneEntities.js";
import type { ScenarioMap } from "../map/scenarioMap.js";
import { GRID_SIZE, resolveGridCellPosition } from "../map/positions.js";

/**
 * REPLAY-ONLY TRUTH.
 *
 * The full simulated fire is the one thing the coordinator is never told
 * during a run (CLAUDE.md: private world state never reaches the projection
 * or any WebSocket message). It may be shown in exactly one place: replay of
 * a finished run. This module declares the shape of that data and nothing
 * else in apps/web may import it except ReplayView (enforced by
 * liveNeverCarriesTruth.test.ts). It mirrors the sim lane's reveal output
 * (burning/burned cell indices per time) as a LOCAL schema, so apps/web
 * never imports sim-lane packages.
 */

const CellIndex = z.number().int().nonnegative().max(GRID_SIZE * GRID_SIZE - 1);

export const ReplayTruthFrame = z
  .object({
    /** Simulation time of this frame (ms). */
    timeMs: z.number().int().nonnegative(),
    burning: z.array(CellIndex),
    burned: z.array(CellIndex),
  })
  .strict();
export type ReplayTruthFrame = z.infer<typeof ReplayTruthFrame>;

/** A finished run: the coordinator's own recorded projection plus, separately, the truth. */
export const ReplayRecording = z
  .object({
    coordinatorLog: z.array(CoordinatorView).min(1),
    truthFrames: z.array(ReplayTruthFrame).min(1),
  })
  .strict()
  .superRefine((recording, ctx) => {
    const times = recording.truthFrames.map((frame) => frame.timeMs);
    if (times.some((t, i) => i > 0 && t <= times[i - 1]!)) {
      ctx.addIssue({ code: "custom", message: "truthFrames must be strictly increasing in timeMs" });
    }
  });
export type ReplayRecording = z.infer<typeof ReplayRecording>;

/** The latest truth frame at or before `simTimeMs`; null before the first frame. */
export function truthFrameAt(frames: readonly ReplayTruthFrame[], simTimeMs: number): ReplayTruthFrame | null {
  let found: ReplayTruthFrame | null = null;
  for (const frame of frames) {
    if (frame.timeMs <= simTimeMs) found = frame;
    else break;
  }
  return found;
}

/**
 * Overlays the truth on the coordinator's observed cells for display in
 * replay. A cell whose true state the coordinator has a CURRENT matching
 * observation of keeps that observation. Every other truth cell (never
 * observed, or last observed in a different/out-of-date state) is marked
 * `unseen`: that state was never observed, so it must not be presented as an
 * observation with an age.
 */
export function mergeTruthCells(
  observed: readonly FireCellMarker[],
  frame: ReplayTruthFrame,
  map: ScenarioMap,
): FireCellMarker[] {
  const byIndex = new Map(observed.map((cell) => [cell.gridCellIndex, cell] as const));
  const merged: FireCellMarker[] = [];
  const add = (index: number, burnState: "burning" | "burned") => {
    const existing = byIndex.get(index);
    if (existing && existing.burnState === burnState && !existing.stale) {
      merged.push(existing);
    } else {
      merged.push({
        key: `truth-${index}`,
        gridCellIndex: index,
        position: resolveGridCellPosition(map, index),
        burnState,
        stale: false,
        lastObservedAt: frame.timeMs,
        ageMs: 0,
        unseen: true,
      });
    }
    byIndex.delete(index);
  };
  for (const index of frame.burning) add(index, "burning");
  for (const index of frame.burned) add(index, "burned");
  // Observed cells the truth does not list (for example a false report) stay as observed.
  for (const cell of byIndex.values()) merged.push(cell);
  return merged;
}
