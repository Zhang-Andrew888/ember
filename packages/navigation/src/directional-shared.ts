import type { CompassDirection, MovementDirective } from "@ember/domain";
import type { PlanningContext } from "./types.js";

const DIAGONAL = Math.SQRT1_2;
export const VECTORS: Record<CompassDirection, { x: number; y: number }> = {
  north: { x: 0, y: 1 },
  northeast: { x: DIAGONAL, y: DIAGONAL },
  east: { x: 1, y: 0 },
  southeast: { x: DIAGONAL, y: -DIAGONAL },
  south: { x: 0, y: -1 },
  southwest: { x: -DIAGONAL, y: -DIAGONAL },
  west: { x: -1, y: 0 },
  northwest: { x: -DIAGONAL, y: DIAGONAL },
};

export function currentPoint(ctx: PlanningContext): { x: number; y: number } {
  const position = ctx.position;
  if (position.kind === "node") return ctx.road.nodePoint(position.nodeId);
  if (position.kind === "offroad") {
    return {
      x: position.start.x + (position.end.x - position.start.x) * position.progress,
      y: position.start.y + (position.end.y - position.start.y) * position.progress,
    };
  }
  return ctx.road.pointAlong(ctx.road.mustEdge(position.edgeId), position.distanceAlongPolyline);
}

export type { MovementDirective };
