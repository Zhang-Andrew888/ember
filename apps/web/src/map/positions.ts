import type { AgentPosition } from "@ember/domain";
import type { ScenarioMap } from "./scenarioMap.js";
import { worldToScene, type SceneVector } from "./worldScale.js";

export type { SceneVector };

/**
 * Unit vector describing which way an edge-bound entity is facing, for
 * marker orientation. Ignored (not rendered) when position is a node.
 */
export interface SceneHeading {
  readonly dx: number;
  readonly dz: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Resolves a node by ID, or null if it isn't in this scenario map. */
export function resolveNodePosition(map: ScenarioMap, nodeId: string): SceneVector | null {
  const node = map.nodes.get(nodeId);
  return node ? { x: node.x, z: node.z } : null;
}

/** Index of the polyline segment containing `distance` metres, and the fraction along it. */
function locateOnEdge(
  cumulativeMeters: readonly number[],
  distance: number,
): { segment: number; t: number } {
  const total = cumulativeMeters[cumulativeMeters.length - 1] ?? 0;
  const d = clamp(distance, 0, total);
  for (let i = 1; i < cumulativeMeters.length; i++) {
    const end = cumulativeMeters[i]!;
    if (d <= end || i === cumulativeMeters.length - 1) {
      const start = cumulativeMeters[i - 1]!;
      return { segment: i - 1, t: end > start ? (d - start) / (end - start) : 0 };
    }
  }
  return { segment: 0, t: 0 };
}

/**
 * Resolves a point along an edge's polyline at the given distance (sim
 * metres) from its start endpoint. Distances beyond the edge length are
 * clamped, since a stale map must never throw while rendering a live snapshot.
 */
export function resolveEdgePoint(
  map: ScenarioMap,
  edgeId: string,
  distanceAlongPolyline: number,
): SceneVector | null {
  const edge = map.edges.get(edgeId);
  if (!edge) return null;
  const { segment, t } = locateOnEdge(edge.cumulativeMeters, distanceAlongPolyline);
  const a = edge.points[segment]!;
  const b = edge.points[segment + 1]!;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Ordered scene points along an edge, in travel order for the given direction.
 * Null when the edge is unknown to this scenario map.
 */
export function resolveEdgePolyline(
  map: ScenarioMap,
  edgeId: string,
  direction: "forward" | "reverse" = "forward",
): SceneVector[] | null {
  const edge = map.edges.get(edgeId);
  if (!edge) return null;
  const points = edge.points.map((point) => ({ x: point.x, z: point.z }));
  return direction === "forward" ? points : points.reverse();
}

/**
 * Heading along an edge at the given distance (default: start), flipped
 * for the "reverse" travel direction.
 */
export function resolveEdgeHeading(
  map: ScenarioMap,
  edgeId: string,
  direction: "forward" | "reverse",
  distanceAlongPolyline = 0,
): SceneHeading | null {
  const edge = map.edges.get(edgeId);
  if (!edge) return null;
  const { segment } = locateOnEdge(edge.cumulativeMeters, distanceAlongPolyline);
  const a = edge.points[segment]!;
  const b = edge.points[segment + 1]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const sign = direction === "forward" ? 1 : -1;
  return { dx: (sign * dx) / length, dz: (sign * dz) / length };
}

/** Travel direction for an off-road leg (world x → scene dx, world y → scene dz). */
export function resolveOffroadHeading(position: Extract<AgentPosition, { kind: "offroad" }>): SceneHeading | null {
  const dx = position.end.x - position.start.x;
  const dy = position.end.y - position.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return { dx: dx / len, dz: dy / len };
}

/** Resolves any CoordinatorAgentView position to a scene point. */
export function resolveAgentPosition(map: ScenarioMap, position: AgentPosition): SceneVector | null {
  if (position.kind === "node") {
    return resolveNodePosition(map, position.nodeId);
  }
  if (position.kind === "offroad") {
    const { start, end, progress } = position;
    return worldToScene(
      start.x + (end.x - start.x) * progress,
      start.y + (end.y - start.y) * progress,
      map.worldMeters,
    );
  }
  return resolveEdgePoint(map, position.edgeId, position.distanceAlongPolyline);
}

/** The simulation's default grid (64 x 64 cells of 25 m); scenario terrain overrides it when present. */
export const GRID_SIZE = 64;
const CELL_METERS = 25;

/**
 * Centre of a flat terrain grid cell in scene units. The grid comes from the
 * scenario (terrain gridSize/cellMeters) so fire, ground light and tree char
 * all index the same cells; the simulation defaults apply only when the
 * scenario carries no terrain.
 */
export function resolveGridCellPosition(map: ScenarioMap, gridCellIndex: number): SceneVector {
  const size = map.terrain?.gridSize ?? GRID_SIZE;
  const cellMeters = map.terrain?.cellMeters ?? CELL_METERS;
  const gx = gridCellIndex % size;
  const gy = Math.floor(gridCellIndex / size);
  return worldToScene((gx + 0.5) * cellMeters, (gy + 0.5) * cellMeters, map.worldMeters);
}
