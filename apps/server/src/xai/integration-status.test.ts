import { describe, expect, it, vi } from "vitest";
import { serverIntegrationStatus } from "./integration-status.js";

describe("serverIntegrationStatus", () => {
  it("reports deterministic crew planning and never exposes secrets", () => {
    vi.stubEnv("XAI_API_KEY", "super-secret-key-value");
    vi.stubEnv("XAI_INTENT", "1");
    const status = serverIntegrationStatus();
    const json = JSON.stringify(status);
    expect(json).not.toContain("super-secret-key-value");
    expect(status.crewMissionPlanning).toBe("deterministic");
    expect(status.llmCrewPlanning).toBe(false);
    expect(status.grokIntent).toBe(true);
    expect(status.coordinatorIntent.mode).toBe("grok");
    expect(status.coordinatorIntent.missingEnv).toEqual([]);
  });

  it("lists missing env var names when Grok intent is off", () => {
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("XAI_INTENT", "");
    const status = serverIntegrationStatus();
    expect(status.grokIntent).toBe(false);
    expect(status.coordinatorIntent.mode).toBe("scripted");
    expect(status.coordinatorIntent.missingEnv).toEqual(["XAI_API_KEY", "XAI_INTENT"]);
  });

  it("requires XAI_INTENT=1 even when a key is present", () => {
    vi.stubEnv("XAI_API_KEY", "k");
    vi.stubEnv("XAI_INTENT", "");
    const status = serverIntegrationStatus();
    expect(status.grokVoice).toBe(true);
    expect(status.grokIntent).toBe(false);
    expect(status.coordinatorIntent.missingEnv).toEqual(["XAI_INTENT"]);
  });
});
