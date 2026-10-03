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

export const AgentPosition = z.discriminatedUnion("kind", [EdgePosition, NodePosition]);
export type AgentPosition = z.infer<typeof AgentPosition>;
