import { describe, expect, it } from "vitest";
import { scenarioMap } from "../map/activeScenario.js";
import { briefingCallsigns, briefingContent, briefingSites } from "./briefingInfo.js";

describe("briefing/briefingContent", () => {
  it("keeps the authored list for the mock demo", () => {
    const content = briefingContent(scenarioMap, true);
    expect(content.callsigns).toEqual(briefingCallsigns);
    expect(content.sites).toEqual(briefingSites);
  });

  it("lists the scenario's four callsigns and three sites for a live run (docs/FRONTEND.md)", () => {
    const content = briefingContent(scenarioMap, false);
    expect(content.callsigns).toEqual(["Crew 1", "Crew 2", "Crew 3", "Scout"]);
    expect(content.sites.map((site) => site.name)).toEqual(["Ridge Cabins", "Waterworks", "Community Lodge"]);
  });

  it("falls back to the authored list when the scenario carries no roster", () => {
    const empty = { briefing: { sites: [], callsigns: [] } };
    expect(briefingContent(empty, false)).toEqual({ sites: briefingSites, callsigns: briefingCallsigns });
  });
});
