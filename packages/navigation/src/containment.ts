import type { AgentId, NodeId } from "@ember/domain";
import {
  cellCenter,
  GAME_CHANGES,
  gameHoseDangerRadiusM,
  gameHoseRadiusM,
  gameHoseStandoffTargetM,
  gameLineCellRadiusM,
  gameLineSlotSpacingM,
} from "@ember/simulation/model";
import type { RoadIndex } from "@ember/simulation/model";
import { brigadeTargetDistanceFromFireM } from "@ember/simulation/model";
import { lineStandoffNode, nearestStandoffNode, nearestStandoffNodeForBrigade } from "./containment-standoff.js";
import { workOptions } from "./mission.js";
import { DEFAULT_NAV_CONFIG, type MissionTarget, type NavConfig } from "./types.js";

export interface ContainmentLine {
  /** Fire cell the line's anchor crew is hosing. */
  readonly anchorCell: number;
  /** Unit vector from the anchor cell toward the anchor crew: the side every hose sprays from. */
  readonly side: { readonly x: number; readonly y: number };
  /** Where crews already on this line stand. */
  readonly occupied: readonly { readonly x: number; readonly y: number }[];
}

export interface ContainmentBrigadeOptions {
  readonly agentId: AgentId;
  readonly peerCountOnCell: (cell: number) => number;
  readonly peerStandoffNodes: ReadonlySet<string>;
  /** Join this crew's line: same fire front, same side, spaced along it. */
  readonly line?: ContainmentLine;
}

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

/** Standoff on the line's side for cells on the anchor's fire front; null for cells elsewhere. */
function lineSlotFor(road: RoadIndex, cell: number, reach: number, line: ContainmentLine): NodeId | null {
  const a = cellCenter(line.anchorCell);
  const c = cellCenter(cell);
  if (Math.hypot(a.x - c.x, a.y - c.y) > gameLineCellRadiusM()) return null;
  return lineStandoffNode(road, cell, reach, gameHoseStandoffTargetM(), {
    side: line.side,
    minSideDot: GAME_CHANGES.lineSameSideMinDot,
    occupied: line.occupied,
    spacingM: gameLineSlotSpacingM(),
    minDistM: gameHoseDangerRadiusM(),
  });
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
  gameChanges = false,
  brigade?: ContainmentBrigadeOptions,
): MissionTarget[] {
  const required = config.containmentWorkRequired;
  const options = workOptions(required, workRate, config.minWorkMs, config.workStepMs);
  if (options.length === 0) return [];
  const reach = gameChanges ? gameHoseRadiusM() : config.containmentReachM;
  const out: MissionTarget[] = [];
  const seen = new Set<number>();
  for (const cell of knownBurningCells) {
    if (seen.has(cell)) continue;
    seen.add(cell);
    const line = gameChanges ? brigade?.line : undefined;
    let nodeId: NodeId | null = line === undefined ? null : lineSlotFor(road, cell, reach, line);
    if (nodeId === null && gameChanges && brigade !== undefined) {
      const peersOnCell = brigade.peerCountOnCell(cell);
      const targetDist = brigadeTargetDistanceFromFireM(brigade.agentId, peersOnCell);
      for (let step = 0; step < 5; step++) {
        const dist = Math.max(reach * 0.55, targetDist - step * GAME_CHANGES.brigadeLineSpacingM);
        const candidate = nearestStandoffNodeForBrigade(road, cell, reach, dist);
        if (candidate === null) continue;
        if (!brigade.peerStandoffNodes.has(candidate)) {
          nodeId = candidate;
          break;
        }
      }
      if (nodeId === null) {
        nodeId = nearestStandoffNodeForBrigade(road, cell, reach, targetDist);
      }
    } else if (nodeId === null && gameChanges) {
      nodeId = nearestStandoffNode(road, cell, reach);
    } else if (nodeId === null) {
      nodeId = nearestReachableNode(road, cell, reach);
    }
    if (gameChanges && nodeId === null) {
      // Fire beyond hose reach from the road network: route to the nearest node and off-road in mission planning.
      nodeId = nearestReachableNode(road, cell, Infinity);
    }
    if (nodeId === null) continue;
    out.push({
      id: `cell-${cell}`,
      kind: "contain",
      nodeId,
      siteId: null,
      gridCellIndex: cell,
      value: gameChanges ? GAME_CHANGES.suppressMissionValue : 1,
      workOptionsMs: options,
      benefit: (workMs) => Math.min(1, (workMs / 1000) * workRate / required),
    });
  }
  return out;
}
