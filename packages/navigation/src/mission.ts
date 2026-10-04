import { MissionPlan, MissionPlanId, NodeId, SequenceNumber, SimTimeMs, type EdgeId } from "@ember/domain";
import { admitsProtection } from "@ember/forecast";
import { hashValue } from "@ember/knowledge";
import { enumerateApproachRoutes, routeIdOf } from "./approach-routes.js";
import { HazardModel } from "./hazard.js";
import { ReturnTable, timeExpandedSearch, startsFromPosition, type Reach, type SearchStart } from "./search.js";
import {
  ALWAYS_FREE,
  DEFAULT_NAV_CONFIG,
  type MissionSearchResult,
  type MissionTarget,
  type PlanningContext,
  type RankedMission,
  type SiteKnowledge,
} from "./types.js";

/** Work interval candidates: 15 s minimum, 30 s increments, plus the exact remaining work. */
export function workOptions(remainingWorkUnits: number, workRate: number, minMs = 15_000, stepMs = 30_000, bucketMs = 5000): number[] {
  const remainingMs = Math.ceil(((remainingWorkUnits / workRate) * 1000) / bucketMs) * bucketMs;
  if (remainingMs <= 0) return [];
  const out = [Math.min(minMs, remainingMs)];
  for (let w = stepMs; w < remainingMs; w += stepMs) if (w > minMs) out.push(w);
  out.push(remainingMs);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Protection targets from this decision-maker's own knowledge of each site. */
export function protectionTargets(
  sites: readonly SiteKnowledge[],
  workRate = DEFAULT_NAV_CONFIG.crewWorkRate,
  allowed: ReadonlySet<string> | null = null,
): MissionTarget[] {
  const out: MissionTarget[] = [];
  for (const s of sites) {
    if (s.knownResolved || (allowed !== null && !allowed.has(s.siteId))) continue;
    const remaining = Math.max(0, s.requiredWork - s.knownCompletedWork);
    const options = workOptions(remaining, workRate);
    if (options.length === 0) continue;
    out.push({
      id: s.siteId,
      kind: "protect",
      nodeId: s.nodeId,
      siteId: s.siteId,
      value: s.value,
      workOptionsMs: options,
      benefit: (workMs) => (s.value * Math.min(remaining, (workMs / 1000) * workRate)) / s.requiredWork,
    });
  }
  return out;
}

interface Built {
  readonly mission: RankedMission;
}

/** Plan against an explicit hazard model (also used for single-member and horizon-only checks). */
export function planWithHazard(ctx: PlanningContext, hm: HazardModel, targets: readonly MissionTarget[]): RankedMission[] {
  const config = ctx.config ?? DEFAULT_NAV_CONFIG;
  const oracle = ctx.oracle ?? ALWAYS_FREE;
  const starts = startsFromPosition(hm, ctx.position, ctx.nowMs, config);
  if (starts.length === 0) return [];
  const out: Built[] = [];
  const revision = SequenceNumber.parse(ctx.ensemble.knowledgeRevision);

  const search = (from: readonly SearchStart[], ban: ReadonlySet<EdgeId> | undefined, stopAt: ReadonlySet<NodeId>): Reach =>
    timeExpandedSearch({ hm, nowMs: ctx.nowMs, starts: from, oracle, ban, config, stopAt });

  const avoid = new Set<EdgeId>(ctx.avoidEdges ?? []);
  // Built on first use: when no target has an approach there is nothing to return from.
  let built: ReturnTable | null = null;
  const returns = (): ReturnTable => (built ??= new ReturnTable(hm, ctx.nowMs, oracle, avoid, config));
  for (const target of targets) {
    const approaches = enumerateApproachRoutes((ban) => {
      const goal = new Set([target.nodeId]);
      const reach = search(starts, ban, goal);
      const hit = reach.earliest(goal);
      if (hit === null) return null;
      return { legs: reach.legsTo(hit.nodeId, hit.k), k: hit.k };
    }, avoid);
    for (const approach of approaches) {
      const nodeSafeLimit = hm.nodeSafeUntilMs(target.nodeId);
      for (const w of target.workOptionsMs) {
        const workEndK = approach.k + Math.ceil(w / config.bucketMs);
        const arriveMs = ctx.nowMs + approach.k * config.bucketMs;
        const endMs = ctx.nowMs + workEndK * config.bucketMs;
        if (!(endMs < nodeSafeLimit) || !(endMs + config.bufferMs < hm.horizonEndMs)) break;
        const table = returns();
        const arrivalK = table.arrival(target.nodeId, workEndK);
        if (arrivalK < 0) continue;
        const ret = table.returnFrom(target.nodeId, workEndK);
        const hit = { k: arrivalK, nodeId: ret.refuge };
        const returnLegs = ret.legs;
        const legs = [...approach.legs, ...returnLegs];
        const returnMs = (hit.k - workEndK) * config.bucketMs;
        const total = Math.max(1, ((hit.k * config.bucketMs) / 1000));
        const planBody = {
          recipientId: ctx.agentId,
          knowledgeRevision: revision,
          timedLegs: legs,
          workInterval: { startMs: SimTimeMs.parse(arriveMs), endMs: SimTimeMs.parse(endMs) },
          refugeId: NodeId.parse(hit.nodeId),
          reservationRevision: SequenceNumber.parse(0),
          limitingReason:
            w < (target.workOptionsMs[target.workOptionsMs.length - 1] ?? w)
              ? "work_interval_limited_by_forecast"
              : null,
        };
        // Validating and hashing a plan costs more than finding it, and a search yields many candidates of
        // which a caller reads only the best few, so each plan is built on first access.
        let plan: MissionPlan | null = null;
        const buildPlan = (): MissionPlan => {
          const work =
            target.kind === "contain" && target.gridCellIndex !== undefined
              ? { kind: "suppress_fire" as const, gridCellIndex: target.gridCellIndex }
              : undefined;
          return (plan ??= MissionPlan.parse({
            ...planBody,
            ...(work === undefined ? {} : { work }),
            id: MissionPlanId.parse(`plan-${hashValue({ t: target.id, p: planBody, n: ctx.nowMs }).slice(0, 12)}`),
          }));
        };
        out.push({
          mission: {
            target,
            get plan(): MissionPlan {
              return buildPlan();
            },
            score: target.benefit(w) / total,
            approachMs: arriveMs - ctx.nowMs,
            workMs: w,
            returnMs,
            completesAtMs: ctx.nowMs + hit.k * config.bucketMs,
            routeId: routeIdOf(legs),
            refugeNodeId: NodeId.parse(hit.nodeId),
          },
        });
      }
    }
  }
  return out
    .map((b) => b.mission)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.completesAtMs - b.completesAtMs ||
        (a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0) ||
        (a.routeId < b.routeId ? -1 : a.routeId > b.routeId ? 1 : 0),
    );
}

/**
 * Complete mission search: one concrete timed approach, work interval and return that passes
 * every retained member. Rejects with a reason (and limiting members) when none exists.
 */
export function planMissions(ctx: PlanningContext, targets: readonly MissionTarget[]): MissionSearchResult {
  const config = ctx.config ?? DEFAULT_NAV_CONFIG;
  const reject = (reason: string, limiting: readonly string[] = []): MissionSearchResult => ({
    feasible: false,
    best: null,
    candidates: [],
    plan: null,
    limitingReason: reason,
    limitingMemberIds: limiting,
  });
  if (!admitsProtection(ctx.ensemble)) return reject("forecast_unreliable");
  if (targets.length === 0) return reject("no_unresolved_target");

  const hm = new HazardModel(ctx.road, ctx.ensemble, ctx.closedCells, config);
  const candidates = planWithHazard(ctx, hm, targets);
  const best = candidates[0] ?? null;
  if (best !== null) {
    return { feasible: true, best, candidates, plan: best.plan, limitingReason: best.plan.limitingReason, limitingMemberIds: [] };
  }
  // Why: does the horizon alone rule it out, or do specific forecast futures?
  const open = new HazardModel(ctx.road, ctx.ensemble, new Set(), config, []);
  if (planWithHazard(ctx, open, targets).length === 0) return reject("forecast_horizon_insufficient");
  const limiting: string[] = [];
  if (ctx.diagnose === false) return reject("no_feasible_mission_in_model");
  for (const member of ctx.ensemble.members) {
    const single = new HazardModel(ctx.road, ctx.ensemble, ctx.closedCells, config, [member]);
    if (planWithHazard(ctx, single, targets).length === 0) limiting.push(member.id);
  }
  return reject("no_feasible_mission_in_model", limiting);
}
