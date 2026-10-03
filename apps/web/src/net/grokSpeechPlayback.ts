/** Fetch server-prepared xAI TTS (MP3) and play in the browser. */
export async function playPreparedSpeech(
  apiBase: string,
  incidentId: string,
  token: string,
  itemId: string,
): Promise<void> {
  const base = apiBase === "" ? "" : apiBase.replace(/\/$/, "");
  const url = `${base}/incidents/${encodeURIComponent(incidentId)}/speech/${encodeURIComponent(itemId)}`;
  const response = await fetch(url, { headers: { "x-incident-token": token } });
  if (!response.ok) return;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(objectUrl);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("playback failed"));
      void audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
