import { INTERPRETATION_DEADLINE_MS } from "@ember/communication";
import { xaiApiKey } from "./env.js";

export interface TtsRequest {
  readonly text: string;
  readonly voiceId?: string;
  readonly language?: string;
}

const DEFAULT_VOICE = "eve";
const DEFAULT_LANGUAGE = "en";

/** Unary xAI TTS (docs/COMMUNICATION.md). Returns MP3 bytes. */
export async function synthesizeSpeech(
  request: TtsRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const key = xaiApiKey();
  if (key === undefined) throw new Error("XAI_API_KEY is not configured");

  const response = await fetchImpl("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: request.text,
      voice_id: request.voiceId ?? DEFAULT_VOICE,
      language: request.language ?? DEFAULT_LANGUAGE,
    }),
    signal: AbortSignal.timeout(INTERPRETATION_DEADLINE_MS),
  });

  if (!response.ok) {
    throw new Error(`xAI TTS failed: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
