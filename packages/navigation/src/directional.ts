import type { MovementDirective } from "@ember/domain";
import { planOffroadDirectionalMove } from "./directional-offroad.js";
import { currentPoint, VECTORS } from "./directional-shared.js";
import { planMissions } from "./mission.js";
import { DEFAULT_NAV_CONFIG, type MissionSearchResult, type MissionTarget, type PlanningContext } from "./types.js";

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
    if (progress / distance < Math.SQRT1_2 - 1e-9) continue;
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
  if (ctx.gameChanges === true) {
    const offFirst = planOffroadDirectionalMove(ctx, movement);
    if (offFirst.best !== null) return offFirst;
  }
  const targets = directionalTargets(ctx, movement);
  if (targets.length === 0) {
    if (ctx.gameChanges === true) return planOffroadDirectionalMove(ctx, movement);
    return {
      feasible: false,
      best: null,
      candidates: [],
      plan: null,
      limitingReason: "no_road_node_in_direction",
      limitingMemberIds: [],
    };
  }
  const result = planMissions(ctx, targets);
  if (result.best !== null) return result;
  if (ctx.gameChanges === true) {
    const off = planOffroadDirectionalMove(ctx, movement);
    if (off.best !== null) return off;
  }
  return result.limitingReason !== "forecast_unreliable"
    ? { ...result, limitingReason: "no_safe_directional_route" }
    : result;
}
