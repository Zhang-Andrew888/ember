import type { InterpretationRequest } from "@ember/communication";
import { xaiApiKey } from "./env.js";

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

function chatModel(): string {
  const m = process.env.XAI_CHAT_MODEL?.trim();
  return m === "" || m === undefined ? DEFAULT_MODEL : m;
}

function buildSystemPrompt(req: InterpretationRequest): string {
  const directory = JSON.stringify(req.directory, null, 2);
  const active = req.activeRecipientCallsign ?? "(none)";
  return [
    "You interpret wildfire incident coordinator radio traffic into a strict JSON IntentEnvelope.",
    "Respond with JSON only — no markdown, no prose.",
    "Use only public names from the directory; never invent observations or site conditions.",
    "Factual claims about fire or safety that are not in evidence belong in unsupportedClaims as the coordinator's exact wording.",
    "",
    "Schema (all fields required unless noted):",
    '{',
    '  "explicitRecipient": string (optional callsign),',
    '  "kind": "objective" | "relay" | "status" | "clarification_answer",',
    '  "objective": { "kind": "protect"|"observe"|"return"|"hold"|"avoid"|"resume", "targetName": string (optional) } (optional),',
    '  "evidenceQueries": [{ "sourceName", "locationName", "timeSelector": "latest"|"referenced", "referencedReportId" }],',
    '  "unsupportedClaims": string[],',
    '  "clarification": string (optional question when ambiguous)',
    "}",
    "",
    `Active recipient callsign: ${active}`,
    `Directory:\n${directory}`,
  ].join("\n");
}

interface ChatCompletionResponse {
  readonly choices?: readonly { readonly message?: { readonly content?: string | null } }[];
}

/** Chat completion for coordinator intent (legacy /v1/chat/completions). */
export async function completeIntentInterpretation(
  req: InterpretationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = xaiApiKey();
  if (key === undefined) throw new Error("XAI_API_KEY is not configured");

  const response = await fetchImpl("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: chatModel(),
      stream: false,
      temperature: 0,
      messages: [
        { role: "system", content: buildSystemPrompt(req) },
        { role: "user", content: req.text },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`xAI chat failed: ${response.status}`);
  }

  const json = (await response.json()) as ChatCompletionResponse;
  const content = json.choices?.[0]?.message?.content;
  if (content === undefined || content === null || content.trim() === "") {
    throw new Error("xAI chat returned empty content");
  }
  return content;
}
