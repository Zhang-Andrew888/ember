import { CREW_MISSION_PLANNING_LLM_ALLOWED } from "./crew-llm-policy.js";
import { grokIntentEnabled, grokVoiceEnabled, xaiApiKey } from "./env.js";

export type CoordinatorIntentMode = "scripted" | "grok";

export type GrokEnvVar = "XAI_API_KEY" | "XAI_INTENT";

export interface CoordinatorIntentStatus {
  readonly mode: CoordinatorIntentMode;
  /** True when Grok intent would activate (key present and XAI_INTENT=1). */
  readonly active: boolean;
  /** Env vars still missing for Grok intent (never includes secret values). */
  readonly missingEnv: readonly GrokEnvVar[];
}

export interface ServerIntegrationStatus {
  readonly grokVoice: boolean;
  readonly grokIntent: boolean;
  readonly crewMissionPlanning: "deterministic";
  readonly llmCrewPlanning: false;
  readonly coordinatorIntent: CoordinatorIntentStatus;
}

function missingForVoice(): GrokEnvVar[] {
  return xaiApiKey() === undefined ? ["XAI_API_KEY"] : [];
}

function missingForIntent(): GrokEnvVar[] {
  const out: GrokEnvVar[] = [];
  if (xaiApiKey() === undefined) out.push("XAI_API_KEY");
  if (process.env.XAI_INTENT !== "1") out.push("XAI_INTENT");
  return out;
}

/** Operator-facing integration summary; safe to log and expose on GET /health. */
export function serverIntegrationStatus(): ServerIntegrationStatus {
  const intentActive = grokIntentEnabled();
  const missingIntent = intentActive ? [] : missingForIntent();
  return {
    grokVoice: grokVoiceEnabled(),
    grokIntent: intentActive,
    crewMissionPlanning: "deterministic",
    llmCrewPlanning: CREW_MISSION_PLANNING_LLM_ALLOWED,
    coordinatorIntent: {
      mode: intentActive ? "grok" : "scripted",
      active: intentActive,
      missingEnv: missingIntent,
    },
  };
}

/** Voice-only missing env (for dev startup logs). */
export function missingEnvForVoice(): readonly GrokEnvVar[] {
  return missingForVoice();
}
