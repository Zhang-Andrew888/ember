import { z } from "zod";
import { AgentId, MissionPlan, SiteId } from "@ember/domain";

export const PlanMode = z.enum(["normal", "withdrawing", "retreating"]);
export type PlanMode = z.infer<typeof PlanMode>;

/**
 * Inputs that change authoritative or projected state. The ordered, applied input log plus
 * the scenario and seed is everything replay needs.
 */
export const SimInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("commit_plan"),
    agentId: AgentId,
    plan: MissionPlan,
    /** Site worked at between the approach and return legs; null for none or scout dwell. */
    workSiteId: SiteId.nullable(),
    mode: PlanMode,
  }),
  z.object({
    kind: z.literal("report"),
    agentId: AgentId,
    text: z.string(),
    urgent: z.boolean(),
  }),
  z.object({
    kind: z.literal("relay"),
    /** Coordinator-held observation to deliver, preserving its source and observed time. */
    observationId: z.string(),
    toAgentId: AgentId,
  }),
  z.object({
    kind: z.literal("set_active_recipient"),
    recipientId: AgentId.nullable(),
  }),
]);
export type SimInput = z.infer<typeof SimInput>;

export const AppliedInput = z.object({
  /** Simulated time of the step that drained this input. */
  appliedAtMs: z.number().int().nonnegative(),
  ordinal: z.number().int().nonnegative(),
  input: SimInput,
});
export type AppliedInput = z.infer<typeof AppliedInput>;

export interface InputReceipt {
  readonly accepted: boolean;
  readonly status: "queued" | "incident_ended" | "input_closed";
  readonly ordinal: number | null;
}
