import type { MemberState } from "./member-state.js";
import { explainCode } from "./explain.js";

/**
 * Explicit autonomy policy: when a crew refuses an order, when it withdraws, and what it
 * announces. Pure and typed, so every branch is testable. Condition (fatigue, injury risk, morale)
 * can only make a crew refuse or withdraw sooner; it never admits anything the planner rejected.
 */

export interface AutonomyAnnouncement {
  readonly text: string;
  readonly urgent: boolean;
}

/** Refuse limits are gentler than withdraw limits: a crew finishes its task but takes no new one. */
export const AUTONOMY_THRESHOLDS = {
  refuse: { fatigue: 0.8, injuryRisk: 0.5, morale: 0.25 },
  withdraw: { fatigue: 0.92, injuryRisk: 0.7, morale: 0.1 },
} as const;

export type MemberReason = "member_injury_risk" | "member_fatigued" | "member_morale";

/** Most dangerous reason first, so the announcement names what matters most. */
function memberReason(m: MemberState, limits: { fatigue: number; injuryRisk: number; morale: number }): MemberReason | null {
  if (m.injuryRisk >= limits.injuryRisk) return "member_injury_risk";
  if (m.fatigue >= limits.fatigue) return "member_fatigued";
  if (m.morale <= limits.morale) return "member_morale";
  return null;
}

// ---------- orders ----------

export type OrderAction = "accept" | "refuse";

export interface OrderInput {
  /** Objective kind as received (kept a string: unsupported kinds must be refused, not crash). */
  readonly kind: string;
  readonly member: MemberState;
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
  const member = memberReason(input.member, AUTONOMY_THRESHOLDS.refuse);
  if (member !== null) return refuse(callsign, member);
  if (!input.feasible) return refuse(callsign, input.limitingReason ?? "no_feasible_mission_in_model");
  return accept;
}

// ---------- continuation ----------

export type ContinuationPhase = "approach" | "work" | "return";

export interface ContinuationInput {
  readonly member: MemberState;
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
 * Survival reasons first (they come from observation and forecast), then member condition.
 * A crew already returning or withdrawing is already going home and is not told to withdraw again.
 */
export function decideContinuation(callsign: string, input: ContinuationInput): ContinuationDecision {
  if (input.mode !== "normal" || input.phase === "return") return CONTINUE;
  if (input.routeBlocked) return withdraw(callsign, "route_closed_by_observation");
  if (input.certifyFailure !== null) return withdraw(callsign, input.certifyFailure);
  if (!input.forecastReliable) return withdraw(callsign, "forecast_unreliable");
  const member = memberReason(input.member, AUTONOMY_THRESHOLDS.withdraw);
  if (member !== null) return withdraw(callsign, member);
  return CONTINUE;
}
