function restUrl(baseUrl: string, path: string): string {
  if (baseUrl === "") return path;
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Server-side xAI STT proxy (never send the API key from the browser). */
export async function transcribeViaServer(
  apiBase: string,
  incidentId: string,
  token: string,
  audio: Blob,
): Promise<string | null> {
  const buffer = await audio.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const audioBase64 = btoa(binary);

  const response = await fetch(restUrl(apiBase, `/incidents/${encodeURIComponent(incidentId)}/stt`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-incident-token": token,
    },
    body: JSON.stringify({
      audioBase64,
      mimeType: audio.type || "audio/webm",
      filename: "ptt.webm",
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { text?: string };
  return typeof data.text === "string" ? data.text.trim() : null;
}
