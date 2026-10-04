import { scheduledLegs, type AgentPosition, type MissionPlan, type NodeId } from "@ember/domain";
import { HazardModel, extendForecastHorizon, navConfigFireFirst, ObservedOnlyHazardModel } from "./hazard.js";
import { GAME_CHANGES } from "@ember/simulation/model";
import type { ForecastEnsemble } from "@ember/forecast";
import { admitsProtection } from "@ember/forecast";
import type { RoadIndex } from "@ember/simulation/model";
import { DEFAULT_NAV_CONFIG, type NavConfig } from "./types.js";
import { offRoadSpeedMps } from "./travel.js";

function nearestNodeId(road: RoadIndex, x: number, y: number, maxDistM = 5): NodeId | null {
  let best: NodeId | null = null;
  let bestD = maxDistM;
  for (const node of road.map.nodes) {
    const d = Math.hypot(node.x - x, node.y - y);
    if (d <= bestD) {
      bestD = d;
      best = node.id;
    }
  }
  return best;
}

export type CertifyFailure =
  | { readonly kind: "forecast_unreliable" }
  | { readonly kind: "leg"; readonly index: number; readonly edgeId: string }
  | { readonly kind: "wait"; readonly index: number; readonly nodeId: string }
  | { readonly kind: "work"; readonly nodeId: string }
  | { readonly kind: "horizon" };

export interface CertifyResult {
  readonly ok: boolean;
  readonly failure: CertifyFailure | null;
}

export interface CertifyInput {
  readonly road: RoadIndex;
  readonly ensemble: ForecastEnsemble;
  readonly closedCells: ReadonlySet<number>;
  readonly plan: MissionPlan;
  readonly position: AgentPosition;
  /** Index of the leg being traversed (or next to depart). */
  readonly legIndex: number;
  readonly nowMs: number;
  readonly config?: NavConfig;
  /** Use the ensemble even if it is flagged unreliable (never done for admission). */
  readonly ignoreReliability?: boolean;
  /** Game-changes: certify against observed fire only, not forecast spread. */
  readonly fireFirst?: boolean;
  /** Certify against each cell's n-th earliest forecast ignition (the rank the plan was made with). */
  readonly forecastMemberRank?: number;
}

function endNodeOfScheduleEntry(
  road: RoadIndex,
  entry: ReturnType<typeof scheduledLegs>[number],
): NodeId | null {
  if (entry.kind === "offroad") {
    return nearestNodeId(road, entry.leg.end.x, entry.leg.end.y);
  }
  const edge = road.mustEdge(entry.leg.edgeId);
  return entry.leg.direction === "forward" ? edge.to : edge.from;
}

/**
 * Recheck a committed plan's remaining legs, waits and work against the current ensemble and
 * directly observed closures. Cached feasibility counts only while the supporting predictions
 * plus new direct constraints still certify it.
 */
export function certifyPlan(input: CertifyInput): CertifyResult {
  const baseConfig = input.config ?? DEFAULT_NAV_CONFIG;
  const fireFirst = input.fireFirst === true && GAME_CHANGES.ignoreForecastSpreadForFire;
  const config = fireFirst ? navConfigFireFirst(baseConfig) : baseConfig;
  if (input.ignoreReliability !== true && !fireFirst && !admitsProtection(input.ensemble)) {
    return { ok: false, failure: { kind: "forecast_unreliable" } };
  }
  const ensemble = fireFirst ? extendForecastHorizon(input.ensemble, input.nowMs) : input.ensemble;
  const hm = fireFirst
    ? new ObservedOnlyHazardModel(input.road, ensemble, input.closedCells, config)
    : new HazardModel(input.road, ensemble, input.closedCells, config, ensemble.members, input.forecastMemberRank ?? 1);
  const legs = scheduledLegs(input.plan);
  const fail = (failure: CertifyFailure): CertifyResult => ({ ok: false, failure });

  const next = legs[input.legIndex];
  const late =
    input.position.kind === "node" && next !== undefined ? Math.max(0, input.nowMs - next.leg.departMs) : 0;

  for (let i = input.legIndex; i < legs.length; i++) {
    const entry = legs[i]!;
    const leg = entry.leg;
    const departMs = leg.departMs + late;
    const arriveMs = leg.arriveMs + late;
    if (entry.kind === "offroad") {
      const off = entry.leg;
      const speed = offRoadSpeedMps(config) * off.speedFactor;
      if (!(departMs < hm.offRoadLatestDepartMs(off.start.x, off.start.y, off.end.x, off.end.y, speed))) {
        return fail({ kind: "leg", index: i, edgeId: "offroad" });
      }
      if (arriveMs + config.bufferMs >= hm.horizonEndMs) return fail({ kind: "horizon" });
      const endNode = nearestNodeId(input.road, off.end.x, off.end.y);
      if (i === input.legIndex && input.position.kind === "node" && endNode !== null && !hm.nodeSafeAt(endNode, arriveMs)) {
        return fail({ kind: "wait", index: i, nodeId: endNode });
      }
      continue;
    }
    const edge = input.road.mustEdge(entry.leg.edgeId);
    if (i === input.legIndex && input.position.kind === "edge") {
      const dist = input.position.distanceAlongPolyline;
      const toDist = entry.leg.direction === "forward" ? edge.length : 0;
      const delay =
        input.position.direction !== entry.leg.direction ? config.turnaroundMs : input.position.turnaroundTimeRemaining;
      if (!(input.nowMs + delay < hm.partialLatestMs(edge, dist, toDist))) return fail({ kind: "leg", index: i, edgeId: edge.id });
      if (arriveMs + config.bufferMs >= hm.horizonEndMs) return fail({ kind: "horizon" });
      continue;
    }
    if (!(departMs < hm.latestDepartMs(edge, entry.leg.direction))) return fail({ kind: "leg", index: i, edgeId: edge.id });
    if (arriveMs + config.bufferMs >= hm.horizonEndMs) return fail({ kind: "horizon" });
    if (i === input.legIndex && input.position.kind === "node" && !hm.nodeSafeAt(input.position.nodeId, departMs)) {
      return fail({ kind: "wait", index: i, nodeId: input.position.nodeId });
    }
    const prev = i > 0 ? legs[i - 1] : undefined;
    if (prev !== undefined && i > input.legIndex) {
      const node = endNodeOfScheduleEntry(input.road, prev);
      if (node !== null && !hm.nodeSafeAt(node, departMs)) return fail({ kind: "wait", index: i, nodeId: node });
    }
  }
  const work = input.plan.workInterval;
  if (work.endMs > work.startMs && input.nowMs < work.endMs) {
    const approach = legs.filter((entry) => entry.leg.departMs < work.startMs);
    const lastApproach = approach.length > 0 ? approach[approach.length - 1] : undefined;
    let node: NodeId | null = null;
    if (lastApproach !== undefined) {
      node = endNodeOfScheduleEntry(input.road, lastApproach);
    } else if (input.position.kind === "node") {
      node = input.position.nodeId;
    }
    if (node !== null && !hm.nodeSafeAt(node, work.endMs + late)) return fail({ kind: "work", nodeId: node });
  }
  return { ok: true, failure: null };
}
