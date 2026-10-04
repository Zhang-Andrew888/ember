import { MissionPlan, MissionPlanId, NodeId, SequenceNumber, SimTimeMs, type AgentId, type EdgeId, type SiteId } from "@ember/domain";
import { SIM_DEFAULTS, type RoadIndex } from "./model/index.js";
import type { SimInput } from "./inputs.js";

export interface AuthoredMission {
  readonly road: RoadIndex;
  readonly agentId: AgentId;
  readonly planId: string;
  readonly knowledgeRevision: number;
  readonly startNode: NodeId;
  readonly departMs: number;
  /** Edge ids walked in order from startNode to the work node. */
  readonly approach: readonly string[];
  readonly workSiteId: SiteId | null;
  readonly workMs: number;
  /** Edge ids walked from the work node back to a refuge. */
  readonly back: readonly string[];
  readonly mode?: "normal" | "withdrawing" | "retreating";
}

const BUCKET_MS = 5000;

/** Travel time rounded up to the 5-second planning bucket. */
export function legTravelMs(lengthM: number): number {
  const exact = (lengthM / SIM_DEFAULTS.agentSpeedMps) * 1000;
  return Math.ceil(exact / BUCKET_MS) * BUCKET_MS;
}

/**
 * Build a commit_plan input from an authored route. Used by the temporary Slice 1 harness
 * (no permanent command UI): directions and timing are derived, nothing is validated for
 * fire safety here.
 */
export function authoredCommit(m: AuthoredMission): Extract<SimInput, { kind: "commit_plan" }> {
  let at = m.startNode;
  let t = m.departMs;
  const legs: MissionPlan["timedLegs"] = [];
  const walk = (ids: readonly string[]): void => {
    for (const id of ids) {
      const edge = m.road.mustEdge(id as EdgeId);
      const direction = edge.from === at ? "forward" : "reverse";
      if (direction === "reverse" && edge.to !== at) throw new Error(`edge ${id} does not touch ${at}`);
      const arrive = t + legTravelMs(edge.length);
      legs.push({ kind: "road", edgeId: edge.id, direction, departMs: SimTimeMs.parse(t), arriveMs: SimTimeMs.parse(arrive) });
      at = direction === "forward" ? edge.to : edge.from;
      t = arrive;
    }
  };
  walk(m.approach);
  const workStart = t;
  const workEnd = t + m.workMs;
  t = workEnd;
  walk(m.back);
  const plan = MissionPlan.parse({
    id: MissionPlanId.parse(m.planId),
    recipientId: m.agentId,
    knowledgeRevision: SequenceNumber.parse(m.knowledgeRevision),
    timedLegs: legs,
    workInterval: { startMs: workStart, endMs: workEnd },
    refugeId: NodeId.parse(at),
    reservationRevision: 0,
    limitingReason: null,
  });
  return { kind: "commit_plan", agentId: m.agentId, plan, workSiteId: m.workSiteId, mode: m.mode ?? "normal" };
}
