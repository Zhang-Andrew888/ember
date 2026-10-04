/**
 * Issue #126 — product decision on LLM involvement (recorded in repo for operators and implementers).
 *
 * **Decision (issue #126, Andrew to confirm): NO** — LLMs do not propose or certify crew missions.
 * Crew routing, forecast certification, and autonomy refusal stay in the deterministic
 * `@ember/agents` planner. When enabled, Grok only maps coordinator language to a validated
 * `IntentEnvelope`; the gateway and crew controllers retain final authority.
 *
 * If this ever flips to YES, open follow-up issues that specify at minimum:
 * - Permitted crew-local inputs (observations, forecast envelope, directory — never truth fire)
 * - Model output shape (objectives only, no raw routes)
 * - Fallback when the model times out or certifier rejects
 * - Safety gate (same autonomy + sim commit rules as today)
 * - Latency target per replan tick
 */
export const CREW_MISSION_PLANNING_LLM_ALLOWED = false as const;

/** Roles the server may attach an LLM to today. Crew mission planning is intentionally absent. */
export const LLM_SERVER_ROLES = {
  coordinatorIntentInterpreter: true,
  crewMissionPlanning: false,
  safetyCertification: false,
} as const;
