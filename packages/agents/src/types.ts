import type { AgentId, DecisionEvent, MissionPlan, Objective } from "@ember/domain";
import type { ForecastConfig, ForecastEvent } from "@ember/forecast";
import type { NavConfig, PriorityClass, ReservationOracle, ReserveResult } from "@ember/navigation";
import type { AgentProjection, SimInput } from "@ember/simulation";

export type ControllerState =
  | "HOLDING"
  | "PLANNING"
  | "APPROACHING"
  | "WORKING"
  | "RETURNING"
  | "WITHDRAWING"
  | "RETREATING"
  | "STRANDED"
  | "LOST";

export interface ControllerConfig {
  readonly forecast?: ForecastConfig;
  readonly nav?: NavConfig;
  /** Simulated ms a contradiction rebuild takes to become available; the crew never waits for it. */
  readonly rebuildLatencyMs: number;
  /** Optional switching needs this much better score and this long since the last switch. */
  readonly switchMargin: number;
  readonly switchCooldownMs: number;
  /** Reassess idle crews at least this often even without new evidence. */
  readonly reassessEveryMs: number;
}

export const DEFAULT_CONTROLLER_CONFIG: ControllerConfig = {
  rebuildLatencyMs: 10_000,
  switchMargin: 1.2,
  switchCooldownMs: 30_000,
  reassessEveryMs: 25_000,
};

export interface CoordinatorReport {
  readonly text: string;
  readonly urgent: boolean;
}

export interface TickOutput {
  readonly state: ControllerState;
  readonly orders: SimInput[];
  readonly decisions: DecisionEvent[];
  readonly reports: CoordinatorReport[];
  readonly forecastEvents: ForecastEvent[];
}

/**
 * Reservation access handed to a controller. It exposes allocated windows and unavailable
 * slots only: never another agent's observations, forecast or complete task plan.
 */
export interface ReservationHooks {
  oracle(agentId: AgentId, cls: PriorityClass, nowMs: number): ReservationOracle;
  reserve(agentId: AgentId, plan: MissionPlan, cls: PriorityClass, nowMs: number): ReserveResult;
  release(agentId: AgentId): void;
  stillValid(agentId: AgentId, nowMs: number): boolean;
  readonly revision: number;
}

/** What a controller needs from the outside world each tick. */
export interface ControllerEnvironment {
  readonly oracle?: ReservationOracle;
  readonly reservations?: ReservationHooks;
}

/** What an agent can reportably say about itself: only its own knowledge and committed decisions. */
export interface ReportableStatus {
  readonly callsign: string;
  readonly currentAction: string | null;
  readonly objective: string | null;
  readonly returnEstimateSec: number | null;
  readonly lastRejection: string | null;
  readonly knownConditions: string | null;
  readonly lastReport: string | null;
}

/**
 * An independent decision-maker. It sees only its own projection (position, state, own
 * knowledge) plus the public map; never the world seed, remote fire or other agents' knowledge.
 */
export interface AgentController {
  readonly agentId: AgentId;
  readonly state: ControllerState;
  tick(projection: AgentProjection, env?: ControllerEnvironment): TickOutput;
  receiveObjective(objective: Objective): void;
  resumeAutonomous(): void;
  /**
   * A reservation service asks this agent to give up a future slot. It returns a verified
   * revised complete plan, or null if it cannot yield safely. State changes only on adopt.
   */
  proposeYield(nowMs: number): MissionPlan | null;
  adoptRevision(plan: MissionPlan): void;
  status(projection: AgentProjection): ReportableStatus;
}
