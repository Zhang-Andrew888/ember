import { INTERPRETATION_DEADLINE_MS } from "@ember/communication";
import { xaiApiKey } from "./env.js";

export interface SttResult {
  readonly text: string;
}

/** File-based xAI STT (POST /v1/stt). */
export async function transcribeAudio(
  audio: Uint8Array,
  options: { filename?: string; mimeType?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SttResult> {
  const key = xaiApiKey();
  if (key === undefined) throw new Error("XAI_API_KEY is not configured");

  const form = new FormData();
  const name = options.filename ?? "utterance.webm";
  const mime = options.mimeType ?? "audio/webm";
  form.append("file", new Blob([audio], { type: mime }), name);

  const response = await fetchImpl("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(INTERPRETATION_DEADLINE_MS),
  });

  if (!response.ok) {
    throw new Error(`xAI STT failed: ${response.status}`);
  }
  const data = (await response.json()) as { text?: string };
  if (typeof data.text !== "string") throw new Error("xAI STT returned no text");
  return { text: data.text.trim() };
}
