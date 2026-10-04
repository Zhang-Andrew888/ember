import { z } from "zod";
import { EdgeId, NodeId } from "./ids.js";
import { Meters, SimTimeMs } from "./units.js";

/** Agent positioned along a road segment polyline. */
export const EdgePosition = z.object({
  kind: z.literal("edge"),
  edgeId: EdgeId,
  /** Distance traveled from the edge's start endpoint along the polyline. */
  distanceAlongPolyline: Meters,
  direction: z.enum(["forward", "reverse"]),
  /** Remaining simulated ms of turnaround penalty; zero when not reversing. */
  turnaroundTimeRemaining: SimTimeMs,
});
export type EdgePosition = z.infer<typeof EdgePosition>;

/** Agent resting at a road node (refuge, junction, site). */
export const NodePosition = z.object({
  kind: z.literal("node"),
  nodeId: NodeId,
});
export type NodePosition = z.infer<typeof NodePosition>;

/** Coordinates in the current 64 by 64 cell, 25 m/cell incident map. */
export const MapPoint = z.object({
  x: z.number().finite().min(0).max(1600),
  y: z.number().finite().min(0).max(1600),
});
export type MapPoint = z.infer<typeof MapPoint>;

/** Straight-line travel between map points; progress is 0 at start and 1 at end. */
export const OffroadPosition = z.object({
  kind: z.literal("offroad"),
  start: MapPoint,
  end: MapPoint,
  progress: z.number().finite().min(0).max(1),
});
export type OffroadPosition = z.infer<typeof OffroadPosition>;

export const AgentPosition = z.discriminatedUnion("kind", [EdgePosition, NodePosition, OffroadPosition]);
export type AgentPosition = z.infer<typeof AgentPosition>;
