import type { AgentPosition } from "@ember/domain";
import type { ScenarioMap } from "./scenarioMap.js";

export interface SceneVector {
  readonly x: number;
  readonly z: number;
}

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

/**
 * Resolves a point along an edge's polyline at the given distance from its
 * start endpoint. Distances beyond the edge length are clamped, since a
 * stale/placeholder map must never throw while rendering a live snapshot.
 */
export function resolveEdgePoint(
  map: ScenarioMap,
  edgeId: string,
  distanceAlongPolyline: number,
): SceneVector | null {
  const edge = map.edges.get(edgeId);
  if (!edge) return null;
  const from = map.nodes.get(edge.fromNodeId);
  const to = map.nodes.get(edge.toNodeId);
  if (!from || !to) return null;

  const t = edge.lengthMeters > 0 ? clamp(distanceAlongPolyline, 0, edge.lengthMeters) / edge.lengthMeters : 0;
  return {
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

/** Heading along an edge, flipped for the "reverse" travel direction. */
export function resolveEdgeHeading(
  map: ScenarioMap,
  edgeId: string,
  direction: "forward" | "reverse",
): SceneHeading | null {
  const edge = map.edges.get(edgeId);
  if (!edge) return null;
  const from = map.nodes.get(edge.fromNodeId);
  const to = map.nodes.get(edge.toNodeId);
  if (!from || !to) return null;

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  const sign = direction === "forward" ? 1 : -1;
  return { dx: (sign * dx) / length, dz: (sign * dz) / length };
}

/** Resolves any CoordinatorAgentView position (edge or node) to a scene point. */
export function resolveAgentPosition(map: ScenarioMap, position: AgentPosition): SceneVector | null {
  if (position.kind === "node") {
    return resolveNodePosition(map, position.nodeId);
  }
  return resolveEdgePoint(map, position.edgeId, position.distanceAlongPolyline);
}

const GRID_SIZE = 64;
const CELL_METERS = 25;
const SCENE_SIZE = 1400;
const WORLD_METERS = GRID_SIZE * CELL_METERS;

/** Resolves the center of a flat terrain grid cell (matches @ember/simulation/model). */
export function resolveGridCellPosition(gridCellIndex: number): SceneVector {
  const gx = gridCellIndex % GRID_SIZE;
  const gy = Math.floor(gridCellIndex / GRID_SIZE);
  const xm = (gx + 0.5) * CELL_METERS;
  const ym = (gy + 0.5) * CELL_METERS;
  const scale = SCENE_SIZE / WORLD_METERS;
  return {
    x: (xm - WORLD_METERS / 2) * scale,
    z: (ym - WORLD_METERS / 2) * scale,
  };
}
