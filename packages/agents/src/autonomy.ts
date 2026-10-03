import { explainCode } from "./explain.js";

/**
 * Explicit autonomy policy: when a crew refuses an order, when it withdraws, and what it
 * announces. Pure and typed, so every branch is testable. It only names triggers the planning
 * spec already defines (forecast certification, direct observation, forecast reliability, planner
 * feasibility); it never admits anything the planner rejected.
 */

export interface AutonomyAnnouncement {
  readonly text: string;
  readonly urgent: boolean;
}

// ---------- orders ----------

export type OrderAction = "accept" | "refuse";

export interface OrderInput {
  /** Objective kind as received (kept a string: unsupported kinds must be refused, not crash). */
  readonly kind: string;
  readonly forecastReliable: boolean;
  /** Whether the planner found a mission satisfying the margin; ignored for non-work orders. */
  readonly feasible: boolean;
  readonly limitingReason: string | null;
}

export interface OrderDecision {
  readonly action: OrderAction;
  readonly reason: string;
  readonly announcement: AutonomyAnnouncement | null;
}

/** Orders that add exposure. Everything else only restricts or retreats and is always acceptable. */
const WORK_ORDERS: ReadonlySet<string> = new Set(["protect_site", "observe"]);
const ALWAYS_ACCEPTED: ReadonlySet<string> = new Set(["return_to_refuge", "hold", "avoid_corridor", "resume"]);

const accept: OrderDecision = { action: "accept", reason: "order_accepted", announcement: null };

function refuse(callsign: string, reason: string): OrderDecision {
  return { action: "refuse", reason, announcement: { text: explainCode(callsign, "refusal", reason), urgent: true } };
}

export function decideOrder(callsign: string, input: OrderInput): OrderDecision {
  if (ALWAYS_ACCEPTED.has(input.kind)) return accept;
  if (!WORK_ORDERS.has(input.kind)) return refuse(callsign, "objective_not_supported");
  if (!input.forecastReliable) return refuse(callsign, "forecast_unreliable");
  if (!input.feasible) return refuse(callsign, input.limitingReason ?? "no_feasible_mission_in_model");
  return accept;
}

// ---------- continuation ----------

export type ContinuationPhase = "approach" | "work" | "return";

export interface ContinuationInput {
  readonly phase: ContinuationPhase;
  readonly mode: "normal" | "withdrawing" | "retreating";
  readonly routeBlocked: boolean;
  /** Reason code from the plan certifier, or null when the plan still certifies. */
  readonly certifyFailure: string | null;
  readonly forecastReliable: boolean;
}

export interface ContinuationDecision {
  readonly action: "continue" | "withdraw";
  readonly reason: string;
  readonly announcement: AutonomyAnnouncement | null;
}

const CONTINUE: ContinuationDecision = { action: "continue", reason: "plan_holds", announcement: null };

function withdraw(callsign: string, reason: string): ContinuationDecision {
  return { action: "withdraw", reason, announcement: { text: explainCode(callsign, "withdrawal", reason), urgent: true } };
}

/**
 * Survival reasons come from direct observation and the forecast certifier.
 * A crew already withdrawing or retreating is already going home and is not told to withdraw again.
 * A crew on its normal return still withdraws: a closed route or failed certification upgrades it
 * to an emergency return.
 */
export function decideContinuation(callsign: string, input: ContinuationInput): ContinuationDecision {
  if (input.mode !== "normal") return CONTINUE;
  if (input.routeBlocked) return withdraw(callsign, "route_closed_by_observation");
  if (input.certifyFailure !== null) return withdraw(callsign, input.certifyFailure);
  if (!input.forecastReliable) return withdraw(callsign, "forecast_unreliable");
  return CONTINUE;
}
