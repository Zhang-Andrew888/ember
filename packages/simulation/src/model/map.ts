import { z } from "zod";
import { EdgeId, NodeId, SiteId } from "@ember/domain";
import { SIM_DEFAULTS } from "./constants.js";

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const MapNode = z.object({
  id: NodeId,
  x: z.number(),
  y: z.number(),
});
export type MapNode = z.infer<typeof MapNode>;

export const MapEdge = z.object({
  id: EdgeId,
  from: NodeId,
  to: NodeId,
  /** Interior polyline points; the endpoints are the from/to node positions. */
  via: z.array(Point).default([]),
  /** Only one agent may occupy this segment at a time, in either direction. */
  singleCapacity: z.boolean().default(false),
});
export type MapEdge = z.infer<typeof MapEdge>;

export const MapSite = z.object({
  id: SiteId,
  name: z.string(),
  nodeId: NodeId,
  requiredWork: z.number().positive(),
  value: z.number().positive(),
});
export type MapSite = z.infer<typeof MapSite>;

export const MapRefuge = z.object({
  id: z.string(),
  name: z.string(),
  nodeId: NodeId,
});
export type MapRefuge = z.infer<typeof MapRefuge>;

/** Shareable road/site/refuge map. Contains no fire state and no private parameters. */
export const PublicMap = z.object({
  nodes: z.array(MapNode),
  edges: z.array(MapEdge),
  sites: z.array(MapSite),
  refuges: z.array(MapRefuge),
  scoutPoints: z.array(NodeId),
  /** Seed of the authored fuel and height layers (public, unlike the world seed). */
  terrainSeed: z.string(),
  /** Flat grid indices of the briefed initial burning patch. */
  initialFireCells: z.array(z.number().int().nonnegative()),
});
export type PublicMap = z.infer<typeof PublicMap>;

export interface EdgeCell {
  readonly cell: number;
  /** Distance along the edge polyline where the road enters the cell. */
  readonly startDist: number;
  /** Distance along the edge polyline where the road leaves the cell. */
  readonly endDist: number;
}

export interface RoadEdge {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly points: readonly Point[];
  readonly length: number;
  readonly singleCapacity: boolean;
  readonly cells: readonly EdgeCell[];
}

export interface Adjacent {
  readonly edgeId: EdgeId;
  readonly direction: "forward" | "reverse";
  readonly toNode: NodeId;
}

export function cellIndexOf(x: number, y: number): number | null {
  const { gridSize, cellMeters } = SIM_DEFAULTS;
  const gx = Math.floor(x / cellMeters);
  const gy = Math.floor(y / cellMeters);
  if (gx < 0 || gy < 0 || gx >= gridSize || gy >= gridSize) return null;
  return gy * gridSize + gx;
}

export function cellCenter(index: number): Point {
  const { gridSize, cellMeters } = SIM_DEFAULTS;
  const gx = index % gridSize;
  const gy = Math.floor(index / gridSize);
  return { x: (gx + 0.5) * cellMeters, y: (gy + 0.5) * cellMeters };
}

/** Immutable lookup structures derived from a PublicMap. */
export class RoadIndex {
  readonly map: PublicMap;
  readonly nodes = new Map<NodeId, MapNode>();
  readonly edges = new Map<EdgeId, RoadEdge>();
  readonly adjacency = new Map<NodeId, Adjacent[]>();
  /** Edges that cross each grid cell, for closure bookkeeping. */
  readonly edgesByCell = new Map<number, EdgeId[]>();
  readonly refugeNodes: ReadonlySet<NodeId>;

  constructor(map: PublicMap) {
    this.map = map;
    for (const node of map.nodes) {
      this.nodes.set(node.id, node);
      this.adjacency.set(node.id, []);
    }
    for (const edge of map.edges) {
      const a = this.mustNode(edge.from);
      const b = this.mustNode(edge.to);
      const points = [{ x: a.x, y: a.y }, ...edge.via, { x: b.x, y: b.y }];
      const length = polylineLength(points);
      const road: RoadEdge = {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        points,
        length,
        singleCapacity: edge.singleCapacity,
        cells: traceCells(points, length),
      };
      this.edges.set(edge.id, road);
      this.adjacency.get(edge.from)?.push({ edgeId: edge.id, direction: "forward", toNode: edge.to });
      this.adjacency.get(edge.to)?.push({ edgeId: edge.id, direction: "reverse", toNode: edge.from });
      for (const c of road.cells) {
        const list = this.edgesByCell.get(c.cell);
        if (list === undefined) this.edgesByCell.set(c.cell, [edge.id]);
        else if (!list.includes(edge.id)) list.push(edge.id);
      }
    }
    this.refugeNodes = new Set(map.refuges.map((r) => r.nodeId));
  }

  mustNode(id: NodeId): MapNode {
    const node = this.nodes.get(id);
    if (node === undefined) throw new Error(`unknown node ${id}`);
    return node;
  }

  mustEdge(id: EdgeId): RoadEdge {
    const edge = this.edges.get(id);
    if (edge === undefined) throw new Error(`unknown edge ${id}`);
    return edge;
  }

  nodePoint(id: NodeId): Point {
    const node = this.mustNode(id);
    return { x: node.x, y: node.y };
  }

  /** Point `dist` meters from the edge's `from` endpoint along its polyline. */
  pointAlong(edge: RoadEdge, dist: number): Point {
    return pointOnPolyline(edge.points, dist);
  }

  /** Cells whose distance ranges overlap [fromDist, toDist] on an edge. */
  cellsBetween(edge: RoadEdge, fromDist: number, toDist: number): EdgeCell[] {
    const lo = Math.min(fromDist, toDist);
    const hi = Math.max(fromDist, toDist);
    return edge.cells.filter((c) => c.endDist >= lo && c.startDist <= hi);
  }
}

function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export function pointOnPolyline(points: readonly Point[], dist: number): Point {
  let remaining = Math.max(0, dist);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= seg || i === points.length - 1) {
      const f = seg === 0 ? 0 : Math.min(1, remaining / seg);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= seg;
  }
  const last = points[points.length - 1]!;
  return { x: last.x, y: last.y };
}

const TRACE_STEP_M = 1;

function traceCells(points: readonly Point[], length: number): EdgeCell[] {
  const cells: { cell: number; startDist: number; endDist: number }[] = [];
  const steps = Math.max(1, Math.ceil(length / TRACE_STEP_M));
  for (let i = 0; i <= steps; i++) {
    const d = Math.min(length, (i * length) / steps);
    const p = pointOnPolyline(points, d);
    const cell = cellIndexOf(p.x, p.y);
    if (cell === null) continue;
    const last = cells[cells.length - 1];
    if (last !== undefined && last.cell === cell) {
      last.endDist = d;
    } else {
      // Extend the previous run up to the boundary crossing so ranges tile the edge.
      if (last !== undefined) last.endDist = d;
      cells.push({ cell, startDist: d, endDist: d });
    }
  }
  const final = cells[cells.length - 1];
  if (final !== undefined) final.endDist = length;
  return cells;
}
