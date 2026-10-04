import { describe, expect, it } from "vitest";
import { omitScoutCallsigns } from "../format/omitScout.js";
import { scenarioMap } from "../map/activeScenario.js";
import { defaultRecordedMockSnapshots } from "../net/recordedMockPlayback.js";
import { emptyScenario } from "../net/scenarios.js";
import { briefingContent } from "./briefingInfo.js";

describe("briefing/briefingContent", () => {
  it("uses the actual recorded mock start roster and public initial observation", () => {
    const start = defaultRecordedMockSnapshots()[0]!;
    const content = briefingContent(scenarioMap, true);
    expect(content.callsigns).toEqual(omitScoutCallsigns(start.agents.map((agent) => agent.callsign)));
    expect(content.sites).toEqual(start.sites.map((site) => ({ name: site.name, value: site.value })));
    expect(content.preview?.initialFireCells).toEqual(scenarioMap.initialFireCells);
    expect(content.refugeNames).toEqual(["Refuge West", "Refuge South"]);
  });

  it("uses the selected mock scenario roster and omits an unmatched preview", () => {
    const content = briefingContent(scenarioMap, true, "?scenario=empty");
    expect(content.callsigns).toEqual(omitScoutCallsigns(emptyScenario.agents.map((agent) => agent.callsign)));
    expect(content.preview).toBeNull();
  });

  it("uses default playback when a mock preset only changes connection behavior", () => {
    const content = briefingContent(scenarioMap, true, "?scenario=connection-error");
    expect(content.callsigns).toEqual(omitScoutCallsigns(defaultRecordedMockSnapshots()[0]!.agents.map((agent) => agent.callsign)));
  });

  it("shows the local live roster without asserting a pre-start map match", () => {
    const content = briefingContent(scenarioMap, false);
    expect(content.callsigns).toEqual(omitScoutCallsigns(scenarioMap.briefing.callsigns));
    expect(content.sites).toEqual(scenarioMap.briefing.sites);
    expect(content.preview).toBeNull();
  });

  it("never lists a scout, even when the scenario roster still has one (#118)", () => {
    const withScout = { ...scenarioMap, briefing: { ...scenarioMap.briefing, callsigns: ["Crew 1", "Scout", "Crew 2"] } };
    expect(briefingContent(withScout, false).callsigns).toEqual(["Crew 1", "Crew 2"]);
    expect(briefingContent(scenarioMap, true).callsigns.some((callsign) => /scout/i.test(callsign))).toBe(false);
  });
});
