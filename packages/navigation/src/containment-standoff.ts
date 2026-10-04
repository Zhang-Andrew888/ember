import type { NodeId } from "@ember/domain";
import { cellCenter } from "@ember/simulation/model";
import type { RoadIndex } from "@ember/simulation/model";

function distPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function distPointToPolyline(px: number, py: number, points: readonly { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    best = Math.min(best, distPointToSegment(px, py, a.x, a.y, b.x, b.y));
  }
  return best;
}

/**
 * Closest road-network attachment for hose reach: any node or any point along a road segment,
 * returned as the node used for routing (crews may hold mid-edge once in range).
 */
export function nearestStandoffNode(road: RoadIndex, gridCellIndex: number, reachM: number): NodeId | null {
  const c = cellCenter(gridCellIndex);
  let bestId: NodeId | null = null;
  let bestDist = Infinity;

  for (const node of road.map.nodes) {
    const p = road.nodePoint(node.id);
    const dist = Math.hypot(p.x - c.x, p.y - c.y);
    if (dist <= reachM && dist < bestDist) {
      bestDist = dist;
      bestId = node.id;
    }
  }

  for (const edge of road.edges.values()) {
    const lineDist = distPointToPolyline(c.x, c.y, edge.points);
    if (lineDist > reachM) continue;
    const fromP = road.nodePoint(edge.from);
    const toP = road.nodePoint(edge.to);
    const dFrom = Math.hypot(fromP.x - c.x, fromP.y - c.y);
    const dTo = Math.hypot(toP.x - c.x, toP.y - c.y);
    const nodeId = dFrom <= dTo ? edge.from : edge.to;
    if (lineDist < bestDist) {
      bestDist = lineDist;
      bestId = nodeId;
    }
  }

  return bestId;
}

export interface LineStandoffOptions {
  /** Unit vector from the fire toward the side the line sprays from. */
  readonly side: { readonly x: number; readonly y: number };
  readonly minSideDot: number;
  /** Where other line crews stand; slots closer than `spacingM` to these are penalised. */
  readonly occupied: readonly { readonly x: number; readonly y: number }[];
  readonly spacingM: number;
  /** Never stand closer to the fire than this. */
  readonly minDistM: number;
}

/**
 * Road node on the line's side of the fire, within hose reach, near `targetDistM` from the cell and
 * spread along the line away from where other line crews already stand. Null when no road node
 * lies on that side, so the caller can fall back to an ordinary standoff.
 */
export function lineStandoffNode(
  road: RoadIndex,
  gridCellIndex: number,
  maxReachM: number,
  targetDistM: number,
  line: LineStandoffOptions,
): NodeId | null {
  const c = cellCenter(gridCellIndex);
  let bestId: NodeId | null = null;
  let bestScore = Infinity;
  for (const node of road.map.nodes) {
    const p = road.nodePoint(node.id);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxReachM || dist < line.minDistM) continue;
    if ((dx * line.side.x + dy * line.side.y) / dist < line.minSideDot) continue;
    let crowding = 0;
    for (const o of line.occupied) {
      crowding += Math.max(0, line.spacingM - Math.hypot(p.x - o.x, p.y - o.y));
    }
    const score = Math.abs(dist - targetDistM) + 3 * crowding;
    if (score < bestScore || (score === bestScore && bestId !== null && node.id < bestId)) {
      bestScore = score;
      bestId = node.id;
    }
  }
  return bestId;
}

/**
 * Standoff attachment whose distance to the cell is closest to `targetDistM` (within `maxReachM`).
 * Used so brigade slots form a line: nearer slots hold closer, others stop earlier on the road.
 */
export function nearestStandoffNodeForBrigade(
  road: RoadIndex,
  gridCellIndex: number,
  maxReachM: number,
  targetDistM: number,
): NodeId | null {
  const c = cellCenter(gridCellIndex);
  let bestId: NodeId | null = null;
  let bestScore = Infinity;

  const consider = (nodeId: NodeId, dist: number): void => {
    if (dist > maxReachM) return;
    const score = Math.abs(dist - targetDistM);
    if (score < bestScore) {
      bestScore = score;
      bestId = nodeId;
    }
  };

  for (const node of road.map.nodes) {
    const p = road.nodePoint(node.id);
    consider(node.id, Math.hypot(p.x - c.x, p.y - c.y));
  }

  for (const edge of road.edges.values()) {
    const lineDist = distPointToPolyline(c.x, c.y, edge.points);
    if (lineDist > maxReachM) continue;
    const fromP = road.nodePoint(edge.from);
    const toP = road.nodePoint(edge.to);
    consider(edge.from, Math.hypot(fromP.x - c.x, fromP.y - c.y));
    consider(edge.to, Math.hypot(toP.x - c.x, toP.y - c.y));
  }

  return bestId;
}
