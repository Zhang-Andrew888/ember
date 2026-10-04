import type { AgentId, AgentPosition, EdgeId, MissionPlan, NodeId, SiteId, TimedLeg } from "@ember/domain";
import type { ForecastEnsemble } from "@ember/forecast";
import type { RoadIndex } from "@ember/simulation/model";

/** Planning defaults from docs/NAVIGATION_AGENTS.md. */
export interface NavConfig {
  readonly bufferMs: number;
  readonly bucketMs: number;
  readonly minWorkMs: number;
  readonly workStepMs: number;
  readonly speedMps: number;
  readonly turnaroundMs: number;
  readonly crewWorkRate: number;
  readonly reservationGuardMs: number;
  readonly scoutDwellMs: number;
  readonly containmentReachM: number;
  readonly containmentWorkRequired: number;
}

export const DEFAULT_NAV_CONFIG: NavConfig = {
  bufferMs: 30_000,
  bucketMs: 5000,
  minWorkMs: 15_000,
  workStepMs: 30_000,
  speedMps: 4,
  turnaroundMs: 5000,
  crewWorkRate: 1,
  reservationGuardMs: 5000,
  scoutDwellMs: 10_000,
  containmentReachM: 300,
  containmentWorkRequired: 45,
};

/** Timed single-capacity availability, answered without exposing other agents' plans. */
export interface ReservationOracle {
  isFree(edgeId: EdgeId, direction: "forward" | "reverse", enterMs: number, exitMs: number): boolean;
}

export const ALWAYS_FREE: ReservationOracle = { isFree: () => true };

export interface SiteKnowledge {
  readonly siteId: SiteId;
  readonly nodeId: NodeId;
  readonly value: number;
  readonly requiredWork: number;
  /** Work this decision-maker believes is done (initial public progress plus observations). */
  readonly knownCompletedWork: number;
  /** Known protected or destroyed. */
  readonly knownResolved: boolean;
}

/** One candidate destination for a mission. */
export interface MissionTarget {
  readonly id: string;
  readonly kind: "protect" | "observe" | "contain";
  readonly nodeId: NodeId;
  readonly siteId: SiteId | null;
  /** Set when `kind === "contain"`. */
  readonly gridCellIndex?: number;
  readonly value: number;
  /** Candidate work/dwell durations in ms, ascending. */
  readonly workOptionsMs: readonly number[];
  /** Expected additional benefit for a duration, before dividing by total time. */
  readonly benefit: (workMs: number) => number;
}

export interface PlanningContext {
  readonly agentId: AgentId;
  readonly road: RoadIndex;
  readonly ensemble: ForecastEnsemble;
  /** Cells ever directly observed burning or burned: closed regardless of any model. */
  readonly closedCells: ReadonlySet<number>;
  readonly position: AgentPosition;
  readonly nowMs: number;
  readonly oracle?: ReservationOracle;
  readonly config?: NavConfig;
  /** Edges the planner must not use (e.g. an avoid-corridor objective). */
  readonly avoidEdges?: ReadonlySet<EdgeId>;
  /** Name the forecast members that rule out every mission when rejecting (costly; default true). */
  readonly diagnose?: boolean;
}

export interface RankedMission {
  readonly target: MissionTarget;
  readonly plan: MissionPlan;
  readonly score: number;
  readonly approachMs: number;
  readonly workMs: number;
  readonly returnMs: number;
  readonly completesAtMs: number;
  readonly routeId: string;
  readonly refugeNodeId: NodeId;
}

export interface MissionSearchResult {
  readonly feasible: boolean;
  readonly best: RankedMission | null;
  /** Every admitted mission, best first. */
  readonly candidates: readonly RankedMission[];
  readonly plan: MissionPlan | null;
  readonly limitingReason: string | null;
  /** Forecast member ids that individually rule out every mission to the rejected targets. */
  readonly limitingMemberIds: readonly string[];
}

export type { TimedLeg };
