import { MissionPlan, MissionPlanId, SequenceNumber, SimTimeMs, type MapPoint } from "@ember/domain";
import { hashValue } from "@ember/knowledge";
import { GAME_CHANGES, offRoadSegmentTraversable } from "@ember/simulation/model";
import { currentPoint } from "./directional-shared.js";
import { navConfigFireFirst, planningHazardModel } from "./hazard.js";
import { offRoadSpeedMps, offRoadTravelMs } from "./travel.js";
import { DEFAULT_NAV_CONFIG, type MissionSearchResult, type MissionTarget, type PlanningContext } from "./types.js";

/**
 * Game-changes: a crew standing off-road takes a fire-line order by driving straight to its end of
 * the line, then cutting the longest shift the forecast allows. No return leg: the crew picks its
 * next job from wherever the shift ends.
 */
export function planLineFromField(ctx: PlanningContext, target: MissionTarget): MissionSearchResult {
  const none = (reason: string): MissionSearchResult => ({
    feasible: false,
    best: null,
    candidates: [],
    plan: null,
    limitingReason: reason,
    limitingMemberIds: [],
  });
  if (ctx.position.kind !== "offroad" || target.kind !== "line" || target.line === undefined) return none("not_in_field");
  const here = currentPoint(ctx);
  const to = target.line.start;
  if (!offRoadSegmentTraversable(here.x, here.y, to.x, to.y)) return none("no_known_passable_route");
  const arriveMs = ctx.nowMs + offRoadTravelMs(Math.hypot(to.x - here.x, to.y - here.y), ctx.config ?? DEFAULT_NAV_CONFIG);
  // The ranked forecast sets the shift when it can; failing that, cutting line outranks the margin.
  const forecast = shiftUnder(ctx, false, here, to, arriveMs, target.workOptionsMs);
  const shift =
    typeof forecast === "number" || ctx.gameChanges !== true || !GAME_CHANGES.ignoreForecastSpreadForFire
      ? forecast
      : shiftUnder(ctx, true, here, to, arriveMs, target.workOptionsMs);
  if (typeof shift === "string") return none(shift);
  const workMs = shift;
  const planBody = {
    recipientId: ctx.agentId,
    knowledgeRevision: SequenceNumber.parse(ctx.ensemble.knowledgeRevision),
    timedLegs: [],
    offroadLegs: [
      {
        kind: "offroad" as const,
        start: { x: here.x, y: here.y },
        end: { x: to.x, y: to.y },
        departMs: SimTimeMs.parse(ctx.nowMs),
        arriveMs: SimTimeMs.parse(arriveMs),
        speedFactor: 0.5 as const,
      },
    ],
    workInterval: { startMs: SimTimeMs.parse(arriveMs), endMs: SimTimeMs.parse(arriveMs + workMs) },
    work: { kind: "build_line" as const, workNodeId: target.line.workNodeId, start: target.line.start, end: target.line.end },
    refugeId: target.nodeId,
    reservationRevision: SequenceNumber.parse(0),
    limitingReason: workMs < Math.max(...target.workOptionsMs) ? ("work_interval_limited_by_forecast" as const) : null,
  };
  const plan = MissionPlan.parse({
    ...planBody,
    id: MissionPlanId.parse(`line-${hashValue({ t: target.id, p: planBody, n: ctx.nowMs }).slice(0, 12)}`),
  });
  const mission = {
    target,
    plan,
    score: target.benefit(workMs) / Math.max(1, (arriveMs + workMs - ctx.nowMs) / 1000),
    approachMs: arriveMs - ctx.nowMs,
    workMs,
    returnMs: 0,
    completesAtMs: arriveMs + workMs,
    routeId: "line-from-field",
    refugeNodeId: target.nodeId,
  };
  return { feasible: true, best: mission, candidates: [mission], plan, limitingReason: null, limitingMemberIds: [] };
}

/** Longest shift the hazard model allows after arriving at the line, or why there is none. */
function shiftUnder(
  ctx: PlanningContext,
  fireFirst: boolean,
  here: MapPoint,
  to: MapPoint,
  arriveMs: number,
  workOptionsMs: readonly number[],
): number | string {
  const config = fireFirst ? navConfigFireFirst(ctx.config ?? DEFAULT_NAV_CONFIG) : (ctx.config ?? DEFAULT_NAV_CONFIG);
  const hm = planningHazardModel({ ...ctx, config }, fireFirst);
  if (!(ctx.nowMs < hm.offRoadLatestDepartMs(here.x, here.y, to.x, to.y, offRoadSpeedMps(config)))) return "no_feasible_mission_in_model";
  const options = workOptionsMs.filter((w) => arriveMs + w + config.bufferMs < hm.horizonEndMs);
  return options.length === 0 ? "forecast_horizon_insufficient" : Math.max(...options);
}
