import { MissionPlan, MissionPlanId, SequenceNumber, SimTimeMs } from "@ember/domain";
import { hashValue } from "@ember/knowledge";
import { cellCenter, gameHoseRadiusM } from "@ember/simulation/model";
import { nearestReachableNode } from "./containment.js";
import { currentPoint } from "./directional-shared.js";
import type { MissionSearchResult, MissionTarget, PlanningContext } from "./types.js";

/**
 * Game-changes: a crew left off-road beside fire keeps working from where it stands. Picks the
 * nearest containment target whose cell is within hose reach, with no movement.
 */
export function planHoseInPlace(ctx: PlanningContext, targets: readonly MissionTarget[]): MissionSearchResult {
  const none: MissionSearchResult = {
    feasible: false,
    best: null,
    candidates: [],
    plan: null,
    limitingReason: "no_fire_in_hose_reach",
    limitingMemberIds: [],
  };
  if (ctx.position.kind !== "offroad") return none;
  const here = currentPoint(ctx);
  let target: MissionTarget | null = null;
  let targetDist = Infinity;
  for (const t of targets) {
    if (t.kind !== "contain" || t.gridCellIndex === undefined || t.workOptionsMs.length === 0) continue;
    const c = cellCenter(t.gridCellIndex);
    const d = Math.hypot(c.x - here.x, c.y - here.y);
    if (d <= gameHoseRadiusM() && d < targetDist) {
      target = t;
      targetDist = d;
    }
  }
  if (target === null || target.gridCellIndex === undefined) return none;
  const refugeId = nearestReachableNode(ctx.road, target.gridCellIndex, Infinity);
  if (refugeId === null) return none;
  const workMs = Math.max(...target.workOptionsMs);
  const planBody = {
    recipientId: ctx.agentId,
    knowledgeRevision: SequenceNumber.parse(ctx.ensemble.knowledgeRevision),
    timedLegs: [],
    offroadLegs: [],
    workInterval: { startMs: SimTimeMs.parse(ctx.nowMs), endMs: SimTimeMs.parse(ctx.nowMs + workMs) },
    work: { kind: "suppress_fire" as const, gridCellIndex: target.gridCellIndex },
    refugeId,
    reservationRevision: SequenceNumber.parse(0),
    limitingReason: null,
  };
  const plan = MissionPlan.parse({
    ...planBody,
    id: MissionPlanId.parse(`hose-${hashValue({ p: planBody, n: ctx.nowMs }).slice(0, 12)}`),
  });
  const mission = {
    target,
    plan,
    score: target.value * target.benefit(workMs),
    approachMs: 0,
    workMs,
    returnMs: 0,
    completesAtMs: ctx.nowMs + workMs,
    routeId: "hose-in-place",
    refugeNodeId: refugeId,
  };
  return { feasible: true, best: mission, candidates: [mission], plan, limitingReason: null, limitingMemberIds: [] };
}
