import type { NodeId } from "@ember/domain";
import { cellCenter } from "@ember/simulation/model";
import type { RoadIndex } from "@ember/simulation/model";
import { workOptions } from "./mission.js";
import { DEFAULT_NAV_CONFIG, type MissionTarget, type NavConfig } from "./types.js";

/** Nearest road node within containment reach of a grid cell, if any. */
export function nearestReachableNode(
  road: RoadIndex,
  gridCellIndex: number,
  reachM = DEFAULT_NAV_CONFIG.containmentReachM ?? 40,
): NodeId | null {
  const c = cellCenter(gridCellIndex);
  let best: { id: NodeId; dist: number } | null = null;
  for (const node of road.map.nodes) {
    const p = road.nodePoint(node.id);
    const dist = Math.hypot(p.x - c.x, p.y - c.y);
    if (dist > reachM) continue;
    if (best === null || dist < best.dist) best = { id: node.id, dist };
  }
  return best?.id ?? null;
}

/**
 * Containment candidates from cells this crew has observed burning (not coordinator-only truth).
 * Competes with structure-protection targets in the same mission search.
 */
export function containmentTargets(
  knownBurningCells: readonly number[],
  road: RoadIndex,
  workRate = DEFAULT_NAV_CONFIG.crewWorkRate,
  config: NavConfig = DEFAULT_NAV_CONFIG,
): MissionTarget[] {
  const required = config.containmentWorkRequired;
  const options = workOptions(required, workRate, config.minWorkMs, config.workStepMs);
  if (options.length === 0) return [];
  const reach = config.containmentReachM;
  const out: MissionTarget[] = [];
  const seen = new Set<number>();
  for (const cell of knownBurningCells) {
    if (seen.has(cell)) continue;
    seen.add(cell);
    const nodeId = nearestReachableNode(road, cell, reach);
    if (nodeId === null) continue;
    out.push({
      id: `cell-${cell}`,
      kind: "contain",
      nodeId,
      siteId: null,
      gridCellIndex: cell,
      value: 1,
      workOptionsMs: options,
      benefit: (workMs) => Math.min(1, (workMs / 1000) * workRate / required),
    });
  }
  return out;
}
