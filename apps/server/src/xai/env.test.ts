import { describe, it, expect, afterEach, vi } from "vitest";
import { grokIntentEnabled, grokVoiceEnabled } from "./env.js";

describe("xai/env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("grokVoice follows XAI_API_KEY", () => {
    vi.stubEnv("XAI_API_KEY", "k");
    expect(grokVoiceEnabled()).toBe(true);
    vi.stubEnv("XAI_API_KEY", "");
    expect(grokVoiceEnabled()).toBe(false);
  });

  it("grokIntent requires XAI_INTENT=1 and a key", () => {
    vi.stubEnv("XAI_API_KEY", "k");
    vi.stubEnv("XAI_INTENT", "");
    expect(grokIntentEnabled()).toBe(false);
    vi.stubEnv("XAI_INTENT", "1");
    expect(grokIntentEnabled()).toBe(true);
  });
});
