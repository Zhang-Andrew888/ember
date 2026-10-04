import { INTERPRETATION_DEADLINE_MS, type IntentEnvelope, type InterpretationRequest } from "@ember/communication";
import { xaiApiKey } from "./env.js";

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

function chatModel(): string {
  const m = process.env.XAI_CHAT_MODEL?.trim();
  return m === "" || m === undefined ? DEFAULT_MODEL : m;
}

const noEvidence = (): { evidenceQueries: never[]; unsupportedClaims: never[] } => ({ evidenceQueries: [], unsupportedClaims: [] });

/** The 2.4 order language as worked examples for the prompt; tests check each parses and matches the scripted reading. */
export const FIRE_LINE_EXAMPLES: readonly { order: string; envelope: Omit<IntentEnvelope, "commandId" | "inputSequence"> }[] = [
  {
    order: "Crew 1, cut line from Waterworks to Ridge Cabins.",
    envelope: {
      kind: "objective",
      explicitRecipient: "Crew 1",
      objective: { kind: "line", anchor: { placeName: "Waterworks" }, course: { kind: "to_place", placeName: "Ridge Cabins" } },
      ...noEvidence(),
    },
  },
  {
    order: "Crew 1, anchor at East Junction and cut line north to the edge.",
    envelope: {
      kind: "objective",
      explicitRecipient: "Crew 1",
      objective: { kind: "line", anchor: { placeName: "East Junction" }, course: { kind: "heading", direction: "north", toEdge: true } },
      ...noEvidence(),
    },
  },
  {
    order: "Crew 1 and Crew 2, cut line from 200 m west of East Junction, 500 m north. Crew 1 on the south end, Crew 2 on the north end.",
    envelope: {
      kind: "objective",
      objective: {
        kind: "line",
        anchor: { placeName: "East Junction", offsetMeters: 200, offsetDirection: "west" },
        course: { kind: "heading", direction: "north", lengthMeters: 500 },
        crews: [
          { recipient: "Crew 1", end: { compass: "south" } },
          { recipient: "Crew 2", end: { compass: "north" } },
        ],
      },
      ...noEvidence(),
    },
  },
  {
    order: "Crew 1, start 150 meters north of Waterworks, cut line bearing 030 for 400 meters.",
    envelope: {
      kind: "objective",
      explicitRecipient: "Crew 1",
      objective: {
        kind: "line",
        anchor: { placeName: "Waterworks", offsetMeters: 150, offsetDirection: "north" },
        course: { kind: "heading", bearingDeg: 30, lengthMeters: 400 },
      },
      ...noEvidence(),
    },
  },
  {
    order: "Crew 1 and Crew 2, cut line from Waterworks to Ridge Cabins, work toward each other.",
    envelope: {
      kind: "objective",
      objective: {
        kind: "line",
        anchor: { placeName: "Waterworks" },
        course: { kind: "to_place", placeName: "Ridge Cabins" },
        crews: [
          { recipient: "Crew 1", end: "start" },
          { recipient: "Crew 2", end: "far" },
        ],
      },
      ...noEvidence(),
    },
  },
];

/**
 * How to write a fire-line order as an IntentEnvelope. The model describes the order in words; the
 * command gateway turns it into map points (FIREBREAK_PLAN.md 2.4), so the model never computes
 * coordinates, checks the map or judges feasibility.
 */
const FIRE_LINE_GUIDE: readonly string[] = [
  'Orders to cut, build, dig or clear a fire line or firebreak use objective kind "line". "Hold the line" is not one: it is "contain".',
  'For a "line", "anchor" is where it starts: { "placeName": a place from directory.places, "offsetMeters": number, "offsetDirection": compass direction }, with the offset fields only for a start like "200 m west of East Junction".',
  '"course" is where it goes: { "kind": "to_place", "placeName": another directory place } to tie in there, or { "kind": "heading", "direction": compass direction, "bearingDeg": degrees clockwise from north (0 to 360), "lengthMeters": number, "toEdge": true }. Use direction or bearingDeg, not both. Leave lengthMeters out when none is given (the server uses 200 m); use "toEdge": true for "to the edge".',
  'Directions are the real compass, never the screen. If the coordinator says top, bottom, left or right, ask for a compass direction in "clarification". Write spoken numbers as digits: "two hundred meters" is 200 and "bearing zero three zero" is 30.',
  '"crews" says which crew takes which end, only when the coordinator names crews: [{ "recipient": callsign, "end": "start" | "far" | { "compass": direction } | { "placeName": place } }]. "far" is the end away from the anchor; { "compass": "north" } is "the north end". Two crews with no ends named: the first takes "start", the second "far". One crew and no end named: set explicitRecipient and leave crews out.',
  "If the anchor or the course is missing, leave it out and the server will ask the coordinator. Use only places in directory.places.",
  "Examples (order -> envelope; the server adds commandId and inputSequence):",
  ...FIRE_LINE_EXAMPLES.map((e) => JSON.stringify(e.order) + " -> " + JSON.stringify(e.envelope)),
];

/** Exported for boundary tests (#126); not part of the wire contract. */
export function buildIntentSystemPrompt(req: InterpretationRequest): string {
  const directory = JSON.stringify(req.directory, null, 2);
  const active = req.activeRecipientCallsign ?? "(none)";
  return [
    "You interpret wildfire incident coordinator radio traffic into a strict JSON IntentEnvelope.",
    "Respond with JSON only — no markdown, no prose.",
    "Use only public names from the directory; never invent observations or site conditions.",
    "Factual claims about fire or safety that are not in evidence belong in unsupportedClaims as the coordinator's exact wording.",
    ...FIRE_LINE_GUIDE,
    "",
    "Schema (all fields required unless noted):",
    '{',
    '  "explicitRecipient": string (optional callsign),',
    '  "kind": "objective" | "relay" | "status" | "clarification_answer",',
    '  "objective": { "kind": "protect"|"contain"|"observe"|"return"|"hold"|"avoid"|"resume"|"move"|"line", "targetName": string (optional), "direction": "north"|"northeast"|"east"|"southeast"|"south"|"southwest"|"west"|"northwest" (for move), "maxDistanceMeters": number (optional, at most 1200), "anchor", "course", "crews" (line only, described above) } (optional),',
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
  signal?: AbortSignal,
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
        { role: "system", content: buildIntentSystemPrompt(req) },
        { role: "user", content: req.text },
      ],
    }),
    signal: signal ?? AbortSignal.timeout(INTERPRETATION_DEADLINE_MS),
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
