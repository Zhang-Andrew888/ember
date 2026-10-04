import { MissionPlan, MissionPlanId, NodeId, SequenceNumber, SimTimeMs } from "@ember/domain";
import { hashValue } from "@ember/knowledge";
import {
  GAME_CHANGES,
  SIM_DEFAULTS,
  cellIndexOf,
  mapExtentM,
  offRoadSegmentTraversable,
  type RoadIndex,
} from "@ember/simulation/model";
import { extendForecastHorizon, navConfigFireFirst, planningHazardModel } from "./hazard.js";
import { offRoadSpeedMps, offRoadTravelMs } from "./travel.js";
import { DEFAULT_NAV_CONFIG, type MissionSearchResult, type PlanningContext } from "./types.js";
import { VECTORS, currentPoint, type MovementDirective } from "./directional-shared.js";

function nearestRefugeNode(road: RoadIndex, x: number, y: number): NodeId {
  let best: NodeId | null = null;
  let bestD = Infinity;
  for (const r of road.map.refuges) {
    const p = road.nodePoint(r.nodeId);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = r.nodeId;
    }
  }
  if (best === null) throw new Error("scenario has no refuge");
  return best;
}

function endPointInDirection(
  origin: { x: number; y: number },
  heading: { x: number; y: number },
  maxDistanceM: number,
): { x: number; y: number } | null {
  const max = mapExtentM();
  for (let scale = 1; scale >= 0.15; scale -= 0.05) {
    const dist = maxDistanceM * scale;
    let x = origin.x + heading.x * dist;
    let y = origin.y + heading.y * dist;
    x = Math.min(max, Math.max(0, x));
    y = Math.min(max, Math.max(0, y));
    if (offRoadSegmentTraversable(origin.x, origin.y, x, y)) return { x, y };
  }
  return null;
}

/** Off-road move in a compass direction without a certified road return (game-changes). */
export function planOffroadDirectionalMove(ctx: PlanningContext, movement: MovementDirective): MissionSearchResult {
  const reject = (reason: string): MissionSearchResult => ({
    feasible: false,
    best: null,
    candidates: [],
    plan: null,
    limitingReason: reason,
    limitingMemberIds: [],
  });
  if (ctx.gameChanges !== true) return reject("no_safe_directional_route");

  const baseConfig = ctx.config ?? DEFAULT_NAV_CONFIG;
  const config = ctx.gameChanges === true ? navConfigFireFirst(baseConfig) : baseConfig;
  const origin = currentPoint(ctx);
  const heading = VECTORS[movement.direction];
  const end = endPointInDirection(origin, heading, movement.maxDistanceMeters);
  if (end === null) return reject("offroad_not_traversable");

  const fireFirst = ctx.gameChanges === true && GAME_CHANGES.ignoreForecastSpreadForFire;
  const hm = planningHazardModel({ ...ctx, config }, fireFirst);
  const speed = offRoadSpeedMps(config) * GAME_CHANGES.offRoadSpeedFactor;
  const departMs = ctx.nowMs;
  if (!fireFirst && !(departMs < hm.offRoadLatestDepartMs(origin.x, origin.y, end.x, end.y, speed))) {
    return reject("no_safe_directional_route");
  }
  if (fireFirst) {
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - origin.x, end.y - origin.y) / (SIM_DEFAULTS.cellMeters / 2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = origin.x + (end.x - origin.x) * t;
      const y = origin.y + (end.y - origin.y) * t;
      const cell = cellIndexOf(x, y);
      if (cell !== null && ctx.closedCells.has(cell)) return reject("no_safe_directional_route");
    }
  }
  const offMs = offRoadTravelMs(Math.hypot(end.x - origin.x, end.y - origin.y), config);
  const arriveMs = departMs + offMs;
  const horizon = fireFirst ? extendForecastHorizon(ctx.ensemble, ctx.nowMs).horizonEndMs : hm.horizonEndMs;
  if (arriveMs + config.bufferMs >= horizon) return reject("forecast_horizon_insufficient");

  const refugeId = nearestRefugeNode(ctx.road, origin.x, origin.y);
  const revision = SequenceNumber.parse(ctx.ensemble.knowledgeRevision);
  const planBody = {
    recipientId: ctx.agentId,
    knowledgeRevision: revision,
    timedLegs: [],
    offroadLegs: [
      {
        kind: "offroad" as const,
        start: { x: origin.x, y: origin.y },
        end: { x: end.x, y: end.y },
        departMs: SimTimeMs.parse(departMs),
        arriveMs: SimTimeMs.parse(arriveMs),
        speedFactor: 0.5 as const,
      },
    ],
    workInterval: { startMs: SimTimeMs.parse(arriveMs), endMs: SimTimeMs.parse(arriveMs) },
    refugeId: NodeId.parse(refugeId),
    reservationRevision: SequenceNumber.parse(0),
    limitingReason: null,
  };
  const plan = MissionPlan.parse({
    ...planBody,
    id: MissionPlanId.parse(`offdir-${hashValue({ p: planBody, n: ctx.nowMs }).slice(0, 12)}`),
  });
  const target = {
    id: `offroad:${movement.direction}`,
    kind: "observe" as const,
    nodeId: refugeId,
    siteId: null,
    value: 1,
    workOptionsMs: [config.bucketMs] as readonly number[],
    benefit: () => 1,
  };
  const mission = {
    target,
    plan,
    score: 1 / Math.max(1, offMs / 1000),
    approachMs: offMs,
    workMs: 0,
    returnMs: 0,
    completesAtMs: arriveMs,
    routeId: "offroad-direct",
    refugeNodeId: NodeId.parse(refugeId),
  };
  return {
    feasible: true,
    best: mission,
    candidates: [mission],
    plan,
    limitingReason: null,
    limitingMemberIds: [],
  };
}
