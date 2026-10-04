import type { NodeId} from "@ember/domain";
import { MissionPlan, MissionPlanId, SequenceNumber, SimTimeMs, type EdgeId, type TimedLeg } from "@ember/domain";
import { hashValue } from "@ember/knowledge";
import { SIM_DEFAULTS, type RoadEdge } from "@ember/simulation/model";
import type { ForecastMember } from "@ember/forecast";
import { HazardModel } from "./hazard.js";
import { bucketTravelMs, startsFromPosition, timeExpandedSearch } from "./search.js";
import { ALWAYS_FREE, DEFAULT_NAV_CONFIG, type PlanningContext } from "./types.js";

export interface ReturnPlan {
  readonly plan: MissionPlan;
  readonly refugeNodeId: NodeId;
  readonly arriveMs: number;
  /** True for a retreat that failed normal forecast constraints (never normal admission). */
  readonly bestEffort: boolean;
  /** Estimated integrated exposure in simulated seconds, averaged over hypotheses. */
  readonly exposureSeconds: number;
}

function makePlan(ctx: PlanningContext, legs: readonly TimedLeg[], refuge: NodeId, limiting: string | null): MissionPlan {
  const end = legs.length > 0 ? legs[legs.length - 1]!.arriveMs : ctx.nowMs;
  const body = {
    recipientId: ctx.agentId,
    knowledgeRevision: SequenceNumber.parse(ctx.ensemble.knowledgeRevision),
    timedLegs: legs,
    workInterval: { startMs: SimTimeMs.parse(end), endMs: SimTimeMs.parse(end) },
    refugeId: refuge,
    reservationRevision: SequenceNumber.parse(0),
    limitingReason: limiting,
  };
  return MissionPlan.parse({
    ...body,
    id: MissionPlanId.parse(`plan-${hashValue({ b: body, n: ctx.nowMs }).slice(0, 12)}`),
  });
}

/** Normal early departure: the earliest forecast-feasible return to any refuge, or null. */
export function planReturn(ctx: PlanningContext): ReturnPlan | null {
  const config = ctx.config ?? DEFAULT_NAV_CONFIG;
  const hm = new HazardModel(ctx.road, ctx.ensemble, ctx.closedCells, config);
  const starts = startsFromPosition(hm, ctx.position, ctx.nowMs, config);
  if (starts.length === 0) return null;
  const refuges = new Set(ctx.road.map.refuges.map((r) => r.nodeId));
  const reach = timeExpandedSearch({
    hm,
    nowMs: ctx.nowMs,
    starts,
    oracle: ctx.oracle ?? ALWAYS_FREE,
    ban: ctx.avoidEdges,
    config,
    stopAt: refuges,
  });
  const hit = reach.earliest(refuges);
  if (hit === null) return null;
  const legs = reach.legsTo(hit.nodeId, hit.k);
  return {
    plan: makePlan(ctx, legs, hit.nodeId, null),
    refugeNodeId: hit.nodeId,
    arriveMs: ctx.nowMs + hit.k * config.bucketMs,
    bestEffort: false,
    exposureSeconds: 0,
  };
}

function exposureSeconds(
  members: readonly ForecastMember[],
  edge: RoadEdge,
  direction: "forward" | "reverse",
  fromDist: number,
  toDist: number,
  t0: number,
  speed: number,
): number {
  if (members.length === 0) return 0;
  const forward = direction === "forward";
  let total = 0;
  for (const c of edge.cells) {
    const lo = Math.min(fromDist, toDist);
    const hi = Math.max(fromDist, toDist);
    if (c.endDist < lo || c.startDist > hi) continue;
    const a = forward ? Math.max(c.startDist, fromDist) : Math.min(c.endDist, fromDist);
    const b = forward ? Math.min(c.endDist, toDist) : Math.max(c.startDist, toDist);
    const enter = t0 + (Math.abs(a - fromDist) / speed) * 1000;
    const exit = t0 + (Math.abs(b - fromDist) / speed) * 1000;
    for (const m of members) {
      const ign = m.ignitionMs[c.cell]!;
      const overlap = Math.min(exit, ign + SIM_DEFAULTS.cellBurnMs) - Math.max(enter, ign);
      if (overlap > 0) total += overlap / 1000;
    }
  }
  return total / members.length;
}

function edgeKnownClosed(ctx: PlanningContext, edge: RoadEdge, fromDist: number, toDist: number): boolean {
  const lo = Math.min(fromDist, toDist);
  const hi = Math.max(fromDist, toDist);
  return edge.cells.some((c) => c.endDist >= lo && c.startDist <= hi && ctx.closedCells.has(c.cell));
}

/**
 * Emergency retreat when no normal return passes. Considers only physically passable roads
 * (no directly observed burning or closed cell on the way), minimizing estimated exposure
 * across hypotheses first and travel time second. Returns null when nothing is known
 * passable (the agent is then stranded). With an unreliable forecast the broadened
 * provisional candidates rank options, which is never normal admission.
 */
export function planRetreat(ctx: PlanningContext): ReturnPlan | null {
  const config = ctx.config ?? DEFAULT_NAV_CONFIG;
  const members = ctx.ensemble.members.length > 0 ? ctx.ensemble.members : ctx.ensemble.provisional;
  const refuges = new Set(ctx.road.map.refuges.map((r) => r.nodeId));
  const avoid = ctx.avoidEdges ?? new Set<EdgeId>();

  interface Label {
    node: NodeId;
    exposure: number;
    timeMs: number;
    legs: TimedLeg[];
  }
  const better = (a: Label, b: Label): boolean =>
    a.exposure < b.exposure - 1e-9 || (Math.abs(a.exposure - b.exposure) <= 1e-9 && a.timeMs < b.timeMs);

  const seeds: Label[] = [];
  if (ctx.position.kind === "node") {
    seeds.push({ node: ctx.position.nodeId, exposure: 0, timeMs: ctx.nowMs, legs: [] });
  } else if (ctx.position.kind === "edge") {
    const pos = ctx.position;
    const edge = ctx.road.mustEdge(pos.edgeId);
    for (const [direction, delay] of [
      [pos.direction, pos.turnaroundTimeRemaining],
      [pos.direction === "forward" ? "reverse" : "forward", config.turnaroundMs],
    ] as const) {
      const toDist = direction === "forward" ? edge.length : 0;
      // The agent's own cell is not lethal now; only cells it still has to enter matter.
      if (edgeKnownClosed(ctx, edge, pos.distanceAlongPolyline + (direction === "forward" ? 1e-6 : -1e-6), toDist)) continue;
      const t0 = ctx.nowMs + delay;
      const travelMs = delay + bucketTravelMs(Math.abs(toDist - pos.distanceAlongPolyline), config);
      seeds.push({
        node: direction === "forward" ? edge.to : edge.from,
        exposure: exposureSeconds(members, edge, direction, pos.distanceAlongPolyline, toDist, t0, config.speedMps),
        timeMs: ctx.nowMs + travelMs,
        legs: [
          {
            edgeId: edge.id,
            direction,
            departMs: SimTimeMs.parse(ctx.nowMs),
            arriveMs: SimTimeMs.parse(ctx.nowMs + travelMs),
          },
        ],
      });
    }
  }

  const best = new Map<NodeId, Label>();
  const queue: Label[] = [];
  for (const s of seeds) {
    const cur = best.get(s.node);
    if (cur === undefined || better(s, cur)) {
      best.set(s.node, s);
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    queue.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : a.node < b.node ? -1 : 1));
    const label = queue.shift()!;
    if (best.get(label.node) !== label) continue;
    if (refuges.has(label.node)) continue;
    for (const adj of ctx.road.adjacency.get(label.node) ?? []) {
      if (avoid.has(adj.edgeId)) continue;
      const edge = ctx.road.mustEdge(adj.edgeId);
      const fromDist = adj.direction === "forward" ? 0 : edge.length;
      const toDist = adj.direction === "forward" ? edge.length : 0;
      if (edgeKnownClosed(ctx, edge, fromDist, toDist)) continue;
      const travel = bucketTravelMs(edge.length, config);
      const next: Label = {
        node: adj.toNode,
        exposure:
          label.exposure + exposureSeconds(members, edge, adj.direction, fromDist, toDist, label.timeMs, config.speedMps),
        timeMs: label.timeMs + travel,
        legs: [
          ...label.legs,
          {
            edgeId: edge.id,
            direction: adj.direction,
            departMs: SimTimeMs.parse(label.timeMs),
            arriveMs: SimTimeMs.parse(label.timeMs + travel),
          },
        ],
      };
      const cur = best.get(next.node);
      if (cur === undefined || better(next, cur)) {
        best.set(next.node, next);
        queue.push(next);
      }
    }
  }
  const reached = [...best.values()].filter((l) => refuges.has(l.node));
  if (reached.length === 0) return null;
  reached.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : a.node < b.node ? -1 : 1));
  const win = reached[0]!;
  return {
    plan: makePlan(ctx, win.legs, win.node, "best_effort_retreat"),
    refugeNodeId: win.node,
    arriveMs: win.timeMs,
    bestEffort: true,
    exposureSeconds: win.exposure,
  };
}
