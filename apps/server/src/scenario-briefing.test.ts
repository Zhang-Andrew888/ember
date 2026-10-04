import { describe, expect, it } from "vitest";
import { PublicScenarioBriefing } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { publicScenarioBriefing } from "./scenario-briefing.js";

describe("publicScenarioBriefing", () => {
  const scenario = buildSyntheticScenario();
  const briefing = publicScenarioBriefing(scenario);

  it("carries the public graph, named places, roster and briefed ignition", () => {
    expect(PublicScenarioBriefing.safeParse(briefing).success).toBe(true);
    expect(briefing.version).toBe(scenario.version);
    expect(briefing.nodes).toHaveLength(scenario.map.nodes.length);
    expect(briefing.edges.map((edge) => edge.id)).toEqual(scenario.map.edges.map((edge) => edge.id));
    expect(briefing.sites.map((site) => [site.name, site.value])).toEqual(
      scenario.map.sites.map((site) => [site.name, site.value]),
    );
    expect(briefing.refuges.map((refuge) => refuge.name)).toEqual(scenario.map.refuges.map((refuge) => refuge.name));
    expect(briefing.agents).toEqual(scenario.agents.map((agent) => ({ callsign: agent.callsign, role: agent.role })));
    expect(briefing.initialFireCells).toEqual(scenario.map.initialFireCells);
    expect(briefing.gridSize * briefing.cellMeters).toBe(1600);
  });

  it("never exposes site effort or the terrain seed", () => {
    const text = JSON.stringify(briefing);
    expect(text).not.toContain("requiredWork");
    expect(text).not.toContain("terrainSeed");
    expect(text).not.toContain(scenario.map.terrainSeed);
    for (const site of briefing.sites) expect(site).not.toHaveProperty("requiredWork");
  });
});
