import { describe, expect, it } from "vitest";
import { intentIntegrationLabel, intentIntegrationTitle, parseServerHealth } from "./serverHealth.js";

const sample = {
  ok: true,
  protocolVersion: 1,
  grokVoice: true,
  grokIntent: false,
  crewMissionPlanning: "deterministic",
  llmCrewPlanning: false,
  coordinatorIntent: {
    mode: "scripted",
    active: false,
    missingEnv: ["XAI_INTENT"],
  },
} as const;

describe("serverHealth", () => {
  it("parses the server health shape", () => {
    expect(parseServerHealth(sample)).toEqual(sample);
    expect(parseServerHealth({ ok: false })).toBeNull();
  });

  it("labels intent mode without echoing secrets", () => {
    const health = parseServerHealth(sample)!;
    expect(intentIntegrationLabel(health)).toBe("Intent: scripted");
    const title = intentIntegrationTitle(health);
    expect(title).toMatch(/Grok intent, set: XAI_INTENT/);
    expect(title).not.toMatch(/Bearer|sk-/);
  });
});
