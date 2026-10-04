import { MissionPlan, MissionPlanId, NodeId, SequenceNumber, SimTimeMs, type EdgeId } from "@ember/domain";
import { admitsProtection } from "@ember/forecast";
import { hashValue } from "@ember/knowledge";
import { GAME_CHANGES, SIM_DEFAULTS, cellCenter, gameHoseRadiusM } from "@ember/simulation/model";
import { offRoadTravelMs } from "./travel.js";
import { enumerateApproachRoutes, routeIdOf } from "./approach-routes.js";
import { HazardModel, navConfigFireFirst, planningHazardModel } from "./hazard.js";
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
        const gc = ctx.gameChanges === true;
        const skipReturn =
          gc &&
          GAME_CHANGES.skipReturnLegAfterSuppress &&
          (target.kind === "contain" ||
            target.kind === "line" ||
            target.kind === "protect" ||
            (GAME_CHANGES.allowOffroadDirectional && target.kind === "observe"));
        let offroadLegs: MissionPlan["offroadLegs"];
        let workStartMs = arriveMs;
        let workEndMs = endMs;
        if (gc && target.kind === "contain" && target.gridCellIndex !== undefined) {
          const startPt = ctx.road.nodePoint(target.nodeId);
          const endPt = cellCenter(target.gridCellIndex);
          const hoseFromRoad = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) <= gameHoseRadiusM();
          if (!hoseFromRoad) {
            const offMs = offRoadTravelMs(Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y), config);
            workStartMs = arriveMs + offMs;
            workEndMs = workStartMs + w;
            offroadLegs = [
              {
                kind: "offroad" as const,
                start: { x: startPt.x, y: startPt.y },
                end: { x: endPt.x, y: endPt.y },
                departMs: SimTimeMs.parse(arriveMs),
                arriveMs: SimTimeMs.parse(workStartMs),
                speedFactor: 0.5 as const,
              },
            ];
          } else {
            workStartMs = arriveMs;
            workEndMs = arriveMs + w;
          }
        }
        if (gc && target.kind === "line" && target.line !== undefined) {
          const from = ctx.road.nodePoint(target.nodeId);
          const to = target.line.start;
          const offM = Math.hypot(to.x - from.x, to.y - from.y);
          if (offM > SIM_DEFAULTS.cellMeters) {
            workStartMs = arriveMs + offRoadTravelMs(offM, config);
            workEndMs = workStartMs + w;
            offroadLegs = [
              {
                kind: "offroad" as const,
                start: { x: from.x, y: from.y },
                end: { x: to.x, y: to.y },
                departMs: SimTimeMs.parse(arriveMs),
                arriveMs: SimTimeMs.parse(workStartMs),
                speedFactor: 0.5 as const,
              },
            ];
          }
        }
        if (!(workEndMs < nodeSafeLimit) || !(workEndMs + config.bufferMs < hm.horizonEndMs)) break;
        const table = returns();
        const workEndKAdj = Math.ceil((workEndMs - ctx.nowMs) / config.bucketMs);
        const arrivalK = skipReturn ? workEndKAdj : table.arrival(target.nodeId, workEndKAdj);
        if (!skipReturn && arrivalK < 0) continue;
        const ret = skipReturn ? null : table.returnFrom(target.nodeId, workEndKAdj);
        const hit = skipReturn
          ? { k: workEndKAdj, nodeId: target.nodeId }
          : { k: arrivalK, nodeId: ret!.refuge };
        const returnLegs = skipReturn ? [] : ret!.legs;
        const legs = [...approach.legs, ...returnLegs];
        const returnMs = skipReturn ? 0 : (hit.k - workEndKAdj) * config.bucketMs;
        const total = Math.max(1, ((hit.k * config.bucketMs) / 1000));
        const planBody = {
          recipientId: ctx.agentId,
          knowledgeRevision: revision,
          timedLegs: legs,
          ...(offroadLegs === undefined ? {} : { offroadLegs }),
          workInterval: { startMs: SimTimeMs.parse(workStartMs), endMs: SimTimeMs.parse(workEndMs) },
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
              : target.kind === "line" && target.line !== undefined
                ? { kind: "build_line" as const, workNodeId: target.line.workNodeId, start: target.line.start, end: target.line.end }
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
  const gc = ctx.gameChanges === true;
  // Game-changes: fighting fire, cutting line and saving buildings outrank the forecast margin.
  const fireFirst = gc && GAME_CHANGES.ignoreForecastSpreadForFire && targets.length > 0;
  if (!admitsProtection(ctx.ensemble) && !fireFirst) return reject("forecast_unreliable");
  if (targets.length === 0) return reject("no_unresolved_target");

  // A ranked line order keeps its forecast plan when one exists; otherwise the crew goes anyway.
  const ranked =
    fireFirst && admitsProtection(ctx.ensemble) && (ctx.forecastMemberRank ?? 1) > 1 && targets.every((t) => t.kind === "line")
      ? planWithHazard(ctx, planningHazardModel(ctx, false), targets)
      : [];
  if (ranked[0] !== undefined) {
    return { feasible: true, best: ranked[0], candidates: ranked, plan: ranked[0].plan, limitingReason: ranked[0].plan.limitingReason, limitingMemberIds: [] };
  }
  const planCtx: PlanningContext =
    fireFirst ? { ...ctx, config: navConfigFireFirst(config) } : ctx;
  const hm = planningHazardModel(planCtx, fireFirst);
  const candidates = planWithHazard(planCtx, hm, targets);
  const best = candidates[0] ?? null;
  if (best !== null) {
    return { feasible: true, best, candidates, plan: best.plan, limitingReason: best.plan.limitingReason, limitingMemberIds: [] };
  }
  // Why: does the horizon alone rule it out, or do specific forecast futures?
  const open = new HazardModel(planCtx.road, planCtx.ensemble, new Set(), planCtx.config ?? config, []);
  if (planWithHazard(planCtx, open, targets).length === 0) return reject("forecast_horizon_insufficient");
  const limiting: string[] = [];
  if (ctx.diagnose === false) return reject("no_feasible_mission_in_model");
  for (const member of planCtx.ensemble.members) {
    const single = new HazardModel(planCtx.road, planCtx.ensemble, planCtx.closedCells, planCtx.config ?? config, [member]);
    if (planWithHazard(planCtx, single, targets).length === 0) limiting.push(member.id);
  }
  return reject("no_feasible_mission_in_model", limiting);
}
