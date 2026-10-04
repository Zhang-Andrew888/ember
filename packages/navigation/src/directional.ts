import type { CompassDirection, MovementDirective } from "@ember/domain";
import { planMissions } from "./mission.js";
import { DEFAULT_NAV_CONFIG, type MissionSearchResult, type MissionTarget, type PlanningContext } from "./types.js";

const DIAGONAL = Math.SQRT1_2;
const VECTORS: Record<CompassDirection, { x: number; y: number }> = {
  north: { x: 0, y: 1 },
  northeast: { x: DIAGONAL, y: DIAGONAL },
  east: { x: 1, y: 0 },
  southeast: { x: DIAGONAL, y: -DIAGONAL },
  south: { x: 0, y: -1 },
  southwest: { x: -DIAGONAL, y: -DIAGONAL },
  west: { x: -1, y: 0 },
  northwest: { x: -DIAGONAL, y: DIAGONAL },
};

function currentPoint(ctx: PlanningContext): { x: number; y: number } {
  const position = ctx.position;
  if (position.kind === "node") return ctx.road.nodePoint(position.nodeId);
  return ctx.road.pointAlong(ctx.road.mustEdge(position.edgeId), position.distanceAlongPolyline);
}

/** Find road nodes within a 45-degree cone and the requested travel bound. */
export function directionalTargets(ctx: PlanningContext, movement: MovementDirective): MissionTarget[] {
  const origin = currentPoint(ctx);
  const heading = VECTORS[movement.direction];
  const targets: MissionTarget[] = [];
  for (const node of ctx.road.nodes.values()) {
    const dx = node.x - origin.x;
    const dy = node.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1 || distance > movement.maxDistanceMeters) continue;
    const progress = dx * heading.x + dy * heading.y;
    if (progress / distance < DIAGONAL - 1e-9) continue;
    targets.push({
      id: `waypoint:${node.id}`,
      kind: "observe",
      nodeId: node.id,
      siteId: null,
      value: 1,
      // A one-bucket pause marks the stop before the already-certified return route.
      workOptionsMs: [ctx.config?.bucketMs ?? DEFAULT_NAV_CONFIG.bucketMs],
      benefit: () => progress,
    });
  }
  return targets;
}

/** Reuse full mission admission: every route and its return must pass the crew's own hazard model. */
export function planDirectionalMove(ctx: PlanningContext, movement: MovementDirective): MissionSearchResult {
  const targets = directionalTargets(ctx, movement);
  if (targets.length === 0) return {
    feasible: false, best: null, candidates: [], plan: null,
    limitingReason: "no_road_node_in_direction", limitingMemberIds: [],
  };
  const result = planMissions(ctx, targets);
  return result.best === null && result.limitingReason !== "forecast_unreliable"
    ? { ...result, limitingReason: "no_safe_directional_route" }
    : result;
}
