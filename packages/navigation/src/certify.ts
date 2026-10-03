import type { AgentPosition, MissionPlan, NodeId } from "@ember/domain";
import { HazardModel } from "./hazard.js";
import type { ForecastEnsemble } from "@ember/forecast";
import { admitsProtection } from "@ember/forecast";
import type { RoadIndex } from "@ember/simulation/model";
import { DEFAULT_NAV_CONFIG, type NavConfig } from "./types.js";

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
}

/**
 * Recheck a committed plan's remaining legs, waits and work against the current ensemble and
 * directly observed closures. Cached feasibility counts only while the supporting predictions
 * plus new direct constraints still certify it.
 */
export function certifyPlan(input: CertifyInput): CertifyResult {
  const config = input.config ?? DEFAULT_NAV_CONFIG;
  if (input.ignoreReliability !== true && !admitsProtection(input.ensemble)) {
    return { ok: false, failure: { kind: "forecast_unreliable" } };
  }
  const hm = new HazardModel(input.road, input.ensemble, input.closedCells, config);
  const legs = input.plan.timedLegs;
  const fail = (failure: CertifyFailure): CertifyResult => ({ ok: false, failure });

  for (let i = input.legIndex; i < legs.length; i++) {
    const leg = legs[i]!;
    const edge = input.road.mustEdge(leg.edgeId);
    if (i === input.legIndex && input.position.kind === "edge") {
      const dist = input.position.distanceAlongPolyline;
      const toDist = leg.direction === "forward" ? edge.length : 0;
      const delay = input.position.direction !== leg.direction ? config.turnaroundMs : input.position.turnaroundTimeRemaining;
      if (!(input.nowMs + delay < hm.partialLatestMs(edge, dist, toDist))) return fail({ kind: "leg", index: i, edgeId: edge.id });
      if (leg.arriveMs + config.bufferMs >= hm.horizonEndMs) return fail({ kind: "horizon" });
      continue;
    }
    if (!(leg.departMs < hm.latestDepartMs(edge, leg.direction))) return fail({ kind: "leg", index: i, edgeId: edge.id });
    if (leg.arriveMs + config.bufferMs >= hm.horizonEndMs) return fail({ kind: "horizon" });
    if (i === input.legIndex && input.position.kind === "node" && !hm.nodeSafeAt(input.position.nodeId, leg.departMs)) {
      return fail({ kind: "wait", index: i, nodeId: input.position.nodeId });
    }
    const prev = i > 0 ? legs[i - 1] : undefined;
    if (prev !== undefined && i > input.legIndex) {
      const pe = input.road.mustEdge(prev.edgeId);
      const node: NodeId = prev.direction === "forward" ? pe.to : pe.from;
      if (!hm.nodeSafeAt(node, leg.departMs)) return fail({ kind: "wait", index: i, nodeId: node });
    }
  }
  const work = input.plan.workInterval;
  if (work.endMs > work.startMs && input.nowMs < work.endMs) {
    const approachCount = legs.filter((l) => l.departMs < work.startMs).length;
    const lastApproach = approachCount > 0 ? legs[approachCount - 1] : undefined;
    let node: NodeId | null = null;
    if (lastApproach !== undefined) {
      const e = input.road.mustEdge(lastApproach.edgeId);
      node = lastApproach.direction === "forward" ? e.to : e.from;
    } else if (input.position.kind === "node") {
      node = input.position.nodeId;
    }
    if (node !== null && !hm.nodeSafeAt(node, work.endMs)) return fail({ kind: "work", nodeId: node });
  }
  return { ok: true, failure: null };
}
