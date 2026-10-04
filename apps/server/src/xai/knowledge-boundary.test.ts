import { describe, expect, it } from "vitest";
import type { InterpretationRequest } from "@ember/communication";
import { buildSyntheticScenario } from "@ember/simulation";
import { directoryFor } from "../conversation.js";
import { buildIntentSystemPrompt } from "./chat.js";

const sampleReq: InterpretationRequest = {
  commandId: "cmd-1",
  inputSequence: 1,
  text: "Crew 1, protect Ridge Cabins",
  directory: directoryFor(buildSyntheticScenario()),
  activeRecipientCallsign: "Crew 1",
};

describe("LLM knowledge boundary (#126)", () => {
  it("intent interpretation requests carry directory and text only — no truth fire grid", () => {
    const serialized = JSON.stringify(sampleReq);
    expect(serialized).not.toMatch(/cellState|spreadMultiplier|privateParameters|truth/i);
    expect(sampleReq.directory.sites.length).toBeGreaterThan(0);
    expect(Object.keys(sampleReq.directory as object)).not.toContain("observedCells");
  });

  it("Grok system prompt forbids inventing observations and omits coordinator-only fire truth", () => {
    const prompt = buildIntentSystemPrompt(sampleReq);
    expect(prompt).not.toMatch(/cellState|truthSnapshot|privateParameters/i);
    expect(prompt).toMatch(/never invent observations/i);
    expect(prompt).toContain("Ridge Cabins");
  });
});
