import { describe, expect, it } from "vitest";
import {
  AgentState,
  DecisionType,
  ObjectiveKind,
  ObservedField,
} from "@ember/domain";
import { buildSyntheticScenario, Incident, recordOf, replayRecord } from "./index.js";

/** Documented in docs/NAVIGATION_AGENTS.md; not represented in domain `AgentState`. */
const NAV_DOC_ONLY_STATES = [
  "holding",
  "planning",
  "returning",
  "stranded",
] as const;

describe("contract issue #3 — domain gaps and sim workarounds", () => {
  it("AgentState omits holding, planning, returning, and stranded", () => {
    const domainValues = new Set(AgentState.options);
    for (const missing of NAV_DOC_ONLY_STATES) {
      expect(domainValues.has(missing as (typeof AgentState.options)[number])).toBe(false);
    }
    expect(domainValues.has("approaching")).toBe(true);
    expect(domainValues.has("lost")).toBe(true);
  });

  it("cell observations use gridCellIndex (not road edgeId)", () => {
    const field = ObservedField.parse({
      kind: "cell",
      gridCellIndex: 1100,
      burnState: "burning",
    });
    expect(field.kind).toBe("cell");
    if (field.kind === "cell") {
      expect(field.gridCellIndex).toBe(1100);
    }
    expect(Object.hasOwn(field as object, "edgeId")).toBe(false);
  });

  it("ObjectiveKind includes avoid_corridor but not resume_autonomous", () => {
    expect(ObjectiveKind.options).toContain("avoid_corridor");
    expect(ObjectiveKind.options).not.toContain("resume_autonomous");
  });

  it("replay truth uses RunRecord via replayRecord, not DomainEvent[] alone", () => {
    const inc = new Incident({
      scenario: buildSyntheticScenario(),
      seed: "contract-gap-replay",
    });
    inc.advanceTo(60_000);
    const outcome = replayRecord(recordOf(inc));
    expect(outcome.hashMatches).toBe(true);
    expect(outcome.incident.simTimeMs).toBe(60_000);
  });

  it("DecisionType has no forecast contradiction or rebuild codes", () => {
    const codes = new Set(DecisionType.options);
    expect(codes.has("forecast_contradiction" as (typeof DecisionType.options)[number])).toBe(false);
    expect(codes.has("forecast_rebuild" as (typeof DecisionType.options)[number])).toBe(false);
    expect(codes.has("stranded_reported" as (typeof DecisionType.options)[number])).toBe(true);
  });
});
