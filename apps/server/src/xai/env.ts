/** Server-side xAI credentials. Never expose to the browser. */
export function xaiApiKey(): string | undefined {
  const key = process.env.XAI_API_KEY?.trim();
  return key === "" ? undefined : key;
}

export function grokVoiceEnabled(): boolean {
  return xaiApiKey() !== undefined;
}

/** Chat-based Grok intent; requires `XAI_INTENT=1` and `XAI_API_KEY`. */
export function grokIntentEnabled(): boolean {
  return xaiApiKey() !== undefined && process.env.XAI_INTENT === "1";
}
