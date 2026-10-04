import { describe, expect, it } from "vitest";
import { AgentState } from "@ember/domain";
import { agentCue, agentLabelText, displayState, crewNumber, damageNotches, siteCue, siteModelKind } from "./markerCues.js";
import type { SiteProtectionStatus } from "../../../format/reports.js";

describe("agent cues", () => {
  it("every agent state has a cue and a text; only idle has no glyph", () => {
    for (const state of AgentState.options) {
      const cue = agentCue(state);
      expect(cue.text.length).toBeGreaterThan(0);
      expect(cue.glyph === "none").toBe(state === "idle");
    }
  });

  it("each non-idle state has its own glyph (no two states share a shape)", () => {
    const glyphs = AgentState.options.filter((s) => s !== "idle").map((s) => agentCue(s).glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("returning has its own glyph and text, distinct from every domain state", () => {
    const glyphs = [...AgentState.options.filter((s) => s !== "idle"), "returning" as const].map((s) => agentCue(s).glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    expect(agentCue("returning").text).toBe("returning");
    expect(agentLabelText("Crew 1", "returning")).toBe("Crew 1 · returning");
  });

  it("an approaching crew on its return leg reads as returning; nothing else changes", () => {
    expect(displayState("approaching", "return")).toBe("returning");
    expect(displayState("approaching", "approach")).toBe("approaching");
    expect(displayState("approaching", null)).toBe("approaching");
    expect(displayState("approaching", undefined)).toBe("approaching");
    for (const state of AgentState.options.filter((s) => s !== "approaching")) {
      expect(displayState(state, "return")).toBe(state);
    }
  });

  it("lost crews are knocked over and muted, others upright", () => {
    expect(agentCue("lost")).toMatchObject({ lying: true, muted: true });
    expect(agentCue("working")).toMatchObject({ lying: false, muted: false });
  });

  it("the label always spells the state", () => {
    expect(agentLabelText("Crew 1", "working")).toBe("Crew 1 · working");
    expect(agentLabelText("Crew 4", "lost")).toBe("Crew 4 · lost");
  });
});

describe("crewNumber", () => {
  it("reads the number from the callsign, falling back to order, clamped 1..5", () => {
    expect(crewNumber("Crew 2", 0)).toBe(2);
    expect(crewNumber("Engine", 2)).toBe(3);
    expect(crewNumber("Crew 99", 0)).toBe(5);
    expect(crewNumber("Crew 0", 0)).toBe(1);
  });
});

describe("site cues", () => {
  const statuses: SiteProtectionStatus[] = ["unobserved", "unprotected", "partially_protected", "destroyed"];

  it("every protection status has a distinct shape treatment", () => {
    const keys = statuses.map((s) => JSON.stringify(siteCue(s)));
    expect(new Set(keys).size).toBe(statuses.length);
  });

  it("only unobserved sites are ghosts; only destroyed sites collapse", () => {
    expect(siteCue("unobserved").ghost).toBe(true);
    expect(statuses.filter((s) => siteCue(s).ghost)).toEqual(["unobserved"]);
    expect(statuses.filter((s) => siteCue(s).collapsed)).toEqual(["destroyed"]);
  });

  it("picks a silhouette by name, rotating through the three for unknown names", () => {
    expect(siteModelKind("Ridge Cabins", 5)).toBe("cabins");
    expect(siteModelKind("Waterworks", 0)).toBe("waterworks");
    expect(siteModelKind("Community Lodge", 0)).toBe("lodge");
    expect(new Set([0, 1, 2].map((i) => siteModelKind("Mystery", i))).size).toBe(3);
  });
});

describe("damageNotches", () => {
  it("is separate from protection: null when unobserved, 0 when undamaged, 1..4 otherwise", () => {
    expect(damageNotches(null)).toBeNull();
    expect(damageNotches(0)).toBe(0);
    expect(damageNotches(0.01)).toBe(1);
    expect(damageNotches(0.5)).toBe(2);
    expect(damageNotches(0.6)).toBe(3);
    expect(damageNotches(1)).toBe(4);
    expect(damageNotches(7)).toBe(4);
  });
});
