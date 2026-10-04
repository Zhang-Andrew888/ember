import { describe, expect, it } from "vitest";
import { omitScoutCallsigns } from "../format/omitScout.js";
import { scenarioMap } from "../map/activeScenario.js";
import { defaultRecordedMockSnapshots } from "../net/recordedMockPlayback.js";
import { emptyScenario } from "../net/scenarios.js";
import { worldToScene } from "../map/worldScale.js";
import { briefingContent } from "./briefingInfo.js";
import { publicScenario } from "./publicScenario.fixture.js";

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

  it("shows the local live roster without a map until the server publishes its scenario", () => {
    const content = briefingContent(scenarioMap, false);
    expect(content.callsigns).toEqual(omitScoutCallsigns(scenarioMap.briefing.callsigns));
    expect(content.sites).toEqual(scenarioMap.briefing.sites);
    expect(content.preview).toBeNull();
  });

  it("builds the live briefing and starting picture from the server's published scenario", () => {
    const content = briefingContent(scenarioMap, false, "", publicScenario);
    expect(content.sites).toEqual([
      { name: "Ridge Cabins", value: 1 },
      { name: "Waterworks", value: 1.5 },
      { name: "Community Lodge", value: 2 },
    ]);
    expect(content.callsigns).toEqual(["Crew 1", "Crew 2", "Crew 3"]);
    expect(content.refugeNames).toEqual(["Refuge West", "Refuge South"]);

    const preview = content.preview!;
    expect(preview.gridSize).toBe(64);
    expect(preview.worldMeters).toBe(1600);
    expect(preview.initialFireCells).toEqual([...publicScenario.initialFireCells].sort((a, b) => a - b));
    expect(preview.roads).toHaveLength(publicScenario.edges.length);
    // Roads run node to node with via points between; the server's metres become scene units.
    const curved = preview.roads.find((road) => road.id === "e-rs-sc")!;
    expect(curved.points).toHaveLength(3);
    expect(curved.points[0]).toEqual(worldToScene(800, 100, 1600));
    expect(curved.points[1]).toEqual(worldToScene(1000, 250, 1600));
    expect(preview.sites.find((site) => site.name === "Waterworks")).toEqual({
      name: "Waterworks",
      ...worldToScene(1250, 800, 1600),
    });
    expect(preview.refuges.map((refuge) => refuge.name)).toEqual(["Refuge West", "Refuge South"]);
  });

  it("ignores a server scenario in mock mode, which always briefs from the recorded start", () => {
    const content = briefingContent(scenarioMap, true, "", publicScenario);
    expect(content.preview?.initialFireCells).toEqual(scenarioMap.initialFireCells);
  });

  it("never lists a scout, even when the scenario roster still has one (#118)", () => {
    const withScout = { ...scenarioMap, briefing: { ...scenarioMap.briefing, callsigns: ["Crew 1", "Scout", "Crew 2"] } };
    expect(briefingContent(withScout, false).callsigns).toEqual(["Crew 1", "Crew 2"]);
    expect(briefingContent(scenarioMap, true).callsigns.some((callsign) => /scout/i.test(callsign))).toBe(false);
  });
});
