import { z } from "zod";
import { EdgeId, NodeId } from "./ids.js";
import { Meters, SimTimeMs } from "./units.js";

/** Travel along a directed road segment (legacy plans omit `kind` and parse as road). */
export const RoadTimedLeg = z.object({
  kind: z.literal("road"),
  edgeId: EdgeId,
  direction: z.enum(["forward", "reverse"]),
  departMs: SimTimeMs,
  arriveMs: SimTimeMs,
});
export type RoadTimedLeg = z.infer<typeof RoadTimedLeg>;

/**
 * Straight-line movement in map meters at off-road speed (#119/#120).
 * Terminates on a road node (`endNodeId`) when the stop rule is `safe_road_node`.
 */
export const OffRoadTimedLeg = z.object({
  kind: z.literal("off_road"),
  fromX: Meters,
  fromY: Meters,
  toX: Meters,
  toY: Meters,
  endNodeId: NodeId,
  departMs: SimTimeMs,
  arriveMs: SimTimeMs,
});
export type OffRoadTimedLeg = z.infer<typeof OffRoadTimedLeg>;

const TimedLegDiscriminated = z.discriminatedUnion("kind", [RoadTimedLeg, OffRoadTimedLeg]);

export const TimedLeg = z.preprocess((value) => {
  if (typeof value === "object" && value !== null && !("kind" in value)) {
    return { ...value, kind: "road" };
  }
  return value;
}, TimedLegDiscriminated);
export type TimedLeg = z.infer<typeof TimedLegDiscriminated>;

export function isRoadLeg(leg: TimedLeg): leg is RoadTimedLeg {
  return leg.kind === "road";
}

export function isOffRoadLeg(leg: TimedLeg): leg is OffRoadTimedLeg {
  return leg.kind === "off_road";
}
