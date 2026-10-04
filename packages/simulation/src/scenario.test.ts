import { describe, expect, it } from "vitest";
import { NodeId } from "@ember/domain";
import { RoadIndex, SIM_DEFAULTS, cellCenter } from "./model/index.js";
import { SimScenario, buildSyntheticScenario, refugeCells, scenarioHash } from "./scenario.js";

describe("synthetic scenario", () => {
  const scenario = buildSyntheticScenario();
  const road = new RoadIndex(scenario.map);

  it("parses against its own schema and hashes stably", () => {
    expect(SimScenario.parse(scenario)).toEqual(scenario);
    expect(scenarioHash(scenario)).toBe(scenarioHash(buildSyntheticScenario()));
    expect(scenarioHash(scenario)).not.toBe(scenarioHash(buildSyntheticScenario({ terrainSeed: "other" })));
  });

  it("can be filtered to one crew and one site", () => {
    const small = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] });
    expect(small.agents.map((a) => a.id)).toEqual(["crew-1"]);
    expect(small.map.sites.map((s) => s.id)).toEqual(["site-a"]);
  });

  it("offers two approaches that differ by at least 20 percent", () => {
    const len = (id: string) => road.mustEdge(id as never).length;
    const south = len("e-j1-s") + len("e-s-h");
    const north = len("e-j1-n") + len("e-n-h");
    expect(north / south).toBeGreaterThanOrEqual(1.2);
  });

  it("keeps one-way refuge-to-site travel within 150-350 simulated seconds on the south route", () => {
    const len = (id: string) => road.mustEdge(id as never).length;
    for (const tail of ["e-h-sa", "e-h-sb", "e-h-sc"]) {
      const seconds = (len("e-rw-j1") + len("e-j1-s") + len("e-s-h") + len(tail)) / SIM_DEFAULTS.agentSpeedMps;
      expect(seconds).toBeGreaterThanOrEqual(150);
      expect(seconds).toBeLessThanOrEqual(350);
    }
  });

  it("marks exactly one single-capacity segment with waiting nodes at both ends", () => {
    const single = scenario.map.edges.filter((e) => e.singleCapacity);
    expect(single.map((e) => e.id)).toEqual(["e-s-h"]);
    for (const node of ["n-s", "n-h"]) {
      expect(road.adjacency.get(NodeId.parse(node))?.length).toBeGreaterThan(1);
    }
  });

  it("starts the fire at least 200 m from agents and sites and outside refuge areas", () => {
    const protectedCells = refugeCells(road, SIM_DEFAULTS.refugeRadiusM);
    expect(scenario.map.initialFireCells).toHaveLength(4);
    const anchors = [
      ...scenario.agents.map((a) => road.nodePoint(a.startNodeId)),
      ...scenario.map.sites.map((s) => road.nodePoint(s.nodeId)),
    ];
    for (const cell of scenario.map.initialFireCells) {
      expect(protectedCells.has(cell)).toBe(false);
      const c = cellCenter(cell);
      for (const a of anchors) expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeGreaterThanOrEqual(200);
    }
  });

  it("contains protection crews only: no scout agent and no scouting points (#117)", () => {
    expect(scenario.agents.map((a) => a.id)).toEqual(["crew-1", "crew-2", "crew-3"]);
    expect(scenario.agents.every((a) => a.role === "protection_crew")).toBe(true);
    expect("scoutPoints" in scenario.map).toBe(false);
  });

  it("still parses an old scenario that carries a scout, for replay compatibility (#117)", () => {
    const legacy = {
      ...scenario,
      agents: [...scenario.agents, { id: "scout", role: "scout", callsign: "Scout", startNodeId: "n-rs" }],
      map: { ...scenario.map, scoutPoints: ["n-n", "n-s", "n-h"] },
    };
    const parsed = SimScenario.parse(legacy);
    expect(parsed.agents.some((a) => a.role === "scout")).toBe(true);
    expect("scoutPoints" in parsed.map).toBe(false);
  });
});
