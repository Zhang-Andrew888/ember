import { MissionPlan, MissionPlanId, NodeId, SequenceNumber, SimTimeMs } from "@ember/domain";
import { hashValue } from "@ember/knowledge";
import { SIM_DEFAULTS, cellCenter, offRoadSegmentTraversable } from "@ember/simulation/model";
import { currentPoint } from "./directional-shared.js";
import { offRoadTravelMs } from "./travel.js";
import { DEFAULT_NAV_CONFIG, type MissionSearchResult, type PlanningContext } from "./types.js";

/** How many of the nearest road nodes to try before giving up. */
const CANDIDATE_NODES = 12;
/** Clearance from known fire beyond which a route counts as fully clear. */
const COMFORT_CLEARANCE_M = 100;

/** Closest approach of the straight drive a→b to any closed cell (Infinity when none are closed). */
export function pathClearanceM(closed: ReadonlySet<number>, a: { x: number; y: number }, b: { x: number; y: number }): number {
  if (closed.size === 0) return Infinity;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (SIM_DEFAULTS.cellMeters / 2)));
  let best = Infinity;
  for (const cell of closed) {
    const c = cellCenter(cell);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      best = Math.min(best, Math.hypot(a.x + (b.x - a.x) * t - c.x, a.y + (b.y - a.y) * t - c.y));
    }
  }
  return best;
}

/**
 * Game-changes: a crew left off-road (end of a patrol or hose leg) cannot start a road search, so
 * it first drives straight to a nearby road node, keeping clear of fire it knows is burning.
 */
export function planRejoinRoad(ctx: PlanningContext): MissionSearchResult {
  const reject = (reason: string): MissionSearchResult => ({
    feasible: false,
    best: null,
    candidates: [],
    plan: null,
    limitingReason: reason,
    limitingMemberIds: [],
  });
  if (ctx.position.kind !== "offroad") return reject("not_offroad");
  const config = ctx.config ?? DEFAULT_NAV_CONFIG;
  const origin = currentPoint(ctx);
  const nearest = [...ctx.road.nodes.values()]
    .map((n) => ({ id: n.id, x: n.x, y: n.y, d: Math.hypot(n.x - origin.x, n.y - origin.y) }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, CANDIDATE_NODES);
  // Prefer short drives that stay well clear of known fire; never pass within a cell of it.
  let pick: { id: string; x: number; y: number; d: number } | null = null;
  let pickScore = Infinity;
  for (const node of nearest) {
    if (node.d < 1) continue;
    if (!offRoadSegmentTraversable(origin.x, origin.y, node.x, node.y)) continue;
    const clearance = pathClearanceM(ctx.closedCells, origin, node);
    if (clearance < SIM_DEFAULTS.cellMeters) continue;
    const score = node.d + 3 * Math.max(0, COMFORT_CLEARANCE_M - clearance);
    if (score < pickScore) {
      pick = node;
      pickScore = score;
    }
  }
  if (pick !== null) {
    const node = pick;
    const arriveMs = ctx.nowMs + offRoadTravelMs(node.d, config);
    const nodeId = NodeId.parse(node.id);
    const planBody = {
      recipientId: ctx.agentId,
      knowledgeRevision: SequenceNumber.parse(ctx.ensemble.knowledgeRevision),
      timedLegs: [],
      offroadLegs: [
        {
          kind: "offroad" as const,
          start: { x: origin.x, y: origin.y },
          end: { x: node.x, y: node.y },
          departMs: SimTimeMs.parse(ctx.nowMs),
          arriveMs: SimTimeMs.parse(arriveMs),
          speedFactor: 0.5 as const,
        },
      ],
      workInterval: { startMs: SimTimeMs.parse(arriveMs), endMs: SimTimeMs.parse(arriveMs) },
      refugeId: nodeId,
      reservationRevision: SequenceNumber.parse(0),
      limitingReason: null,
    };
    const plan = MissionPlan.parse({
      ...planBody,
      id: MissionPlanId.parse(`rejoin-${hashValue({ p: planBody, n: ctx.nowMs }).slice(0, 12)}`),
    });
    const mission = {
      target: {
        id: `rejoin:${node.id}`,
        kind: "observe" as const,
        nodeId,
        siteId: null,
        value: 1,
        workOptionsMs: [config.bucketMs] as readonly number[],
        benefit: () => 1,
      },
      plan,
      score: 1,
      approachMs: arriveMs - ctx.nowMs,
      workMs: 0,
      returnMs: 0,
      completesAtMs: arriveMs,
      routeId: "offroad-rejoin",
      refugeNodeId: nodeId,
    };
    return { feasible: true, best: mission, candidates: [mission], plan, limitingReason: null, limitingMemberIds: [] };
  }
  return reject("no_known_passable_route");
}
