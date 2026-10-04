/**
 * GET /health — operator-facing Grok integration flags (never includes API keys).
 */

export type CoordinatorIntentMode = "scripted" | "grok";

export type GrokEnvVar = "XAI_API_KEY" | "XAI_INTENT";

export interface ServerHealthResponse {
  readonly ok: true;
  readonly protocolVersion: number;
  readonly grokVoice: boolean;
  readonly grokIntent: boolean;
  readonly crewMissionPlanning: "deterministic";
  readonly llmCrewPlanning: false;
  readonly coordinatorIntent: {
    readonly mode: CoordinatorIntentMode;
    readonly active: boolean;
    readonly missingEnv: readonly GrokEnvVar[];
  };
}

function restUrl(baseUrl: string, path: string): string {
  if (baseUrl === "") return path;
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

export function parseServerHealth(data: unknown): ServerHealthResponse | null {
  if (typeof data !== "object" || data === null || (data as { ok?: unknown }).ok !== true) return null;
  const d = data as Record<string, unknown>;
  const intent = d.coordinatorIntent;
  if (typeof intent !== "object" || intent === null) return null;
  const ci = intent as Record<string, unknown>;
  if (typeof d.protocolVersion !== "number") return null;
  if (typeof d.grokVoice !== "boolean" || typeof d.grokIntent !== "boolean") return null;
  if (d.crewMissionPlanning !== "deterministic" || d.llmCrewPlanning !== false) return null;
  if (ci.mode !== "scripted" && ci.mode !== "grok") return null;
  if (typeof ci.active !== "boolean" || !Array.isArray(ci.missingEnv)) return null;
  return data as ServerHealthResponse;
}

export async function fetchServerHealth(baseUrl: string): Promise<ServerHealthResponse | null> {
  try {
    const response = await fetch(restUrl(baseUrl, "/health"));
    if (!response.ok) return null;
    return parseServerHealth(await response.json());
  } catch {
    return null;
  }
}

/** Short label for the top bar; details live in the title attribute. */
export function intentIntegrationLabel(health: ServerHealthResponse): string {
  return health.coordinatorIntent.mode === "grok" ? "Intent: Grok" : "Intent: scripted";
}

export function intentIntegrationTitle(health: ServerHealthResponse): string {
  const { coordinatorIntent, grokVoice, crewMissionPlanning, llmCrewPlanning } = health;
  const lines = [
    `Coordinator command interpreter: ${coordinatorIntent.mode}`,
    `Grok voice (TTS/STT): ${grokVoice ? "on" : "off"}`,
    `Crew mission planning: ${crewMissionPlanning}${llmCrewPlanning ? " (LLM)" : " (no LLM)"}`,
  ];
  if (coordinatorIntent.missingEnv.length > 0) {
    lines.push(`To enable Grok intent, set: ${coordinatorIntent.missingEnv.join(", ")}`);
  }
  return lines.join(". ");
}
