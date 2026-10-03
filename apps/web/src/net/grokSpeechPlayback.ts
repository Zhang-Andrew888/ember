import type { SpeechPlaybackOutcome } from "./wireProtocol.js";

/** Fetch server-prepared xAI TTS (MP3) and play in the browser. */
export async function playPreparedSpeech(
  apiBase: string,
  incidentId: string,
  token: string,
  itemId: string,
): Promise<SpeechPlaybackOutcome> {
  const base = apiBase === "" ? "" : apiBase.replace(/\/$/, "");
  const url = `${base}/incidents/${encodeURIComponent(incidentId)}/speech/${encodeURIComponent(itemId)}`;
  const response = await fetch(url, { headers: { "x-incident-token": token } });
  if (!response.ok) return "failed";
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(objectUrl);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("playback failed"));
      void audio.play().catch(reject);
    });
    return "ended";
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Play one prepared clip and always report the outcome, including a thrown playback or network error.
 * The server uses the report to release the speaking slot.
 */
export async function acknowledgeAfterPlayback(
  itemId: string,
  play: () => Promise<SpeechPlaybackOutcome>,
  report: (itemId: string, outcome: SpeechPlaybackOutcome) => void,
): Promise<void> {
  let outcome: SpeechPlaybackOutcome = "failed";
  try {
    outcome = await play();
  } catch {
    outcome = "failed";
  }
  report(itemId, outcome);
}
