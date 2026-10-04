import { describe, it, expect } from "vitest";
import { fixtureCoordinatorView as rawFixture } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { adaptToScenarioIds } from "../../net/mockBase.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { buildSceneEntities, listRefugeNodes, NODE_CLEARANCE } from "./sceneEntities.js";

// The frozen fixture uses placeholder ids; the adapter maps it onto the real scenario.
const fixtureCoordinatorView = adaptToScenarioIds(rawFixture);

describe("components/scene/sceneEntities - listRefugeNodes", () => {
  it("returns exactly the refuge-kind nodes", () => {
    const refuges = listRefugeNodes(scenarioMap);
    expect(refuges.map((r) => r.id).sort()).toEqual(
      ["n-rs", "n-rw"].sort(),
    );
  });
});

describe("components/scene/sceneEntities - buildSceneEntities", () => {
  const entities = buildSceneEntities(fixtureCoordinatorView, scenarioMap);

  // The shared fixture still has a scout-role agent: a view that carries one (old recording, pre-#117 sim) must resolve.
  it("resolves all three fixture agents, including one with a non-crew role", () => {
    expect(entities.agents).toHaveLength(3);
    expect(entities.agents.map((a) => a.id).sort()).toEqual(["crew-1", "crew-2", "scout"].sort());
  });

  it("gives an edge-bound agent a heading, and a node-bound agent none", () => {
    const crew1 = entities.agents.find((a) => a.id === "crew-1");
    const crew2 = entities.agents.find((a) => a.id === "crew-2");
    expect(crew1?.heading).not.toBeNull();
    expect(crew2?.heading).toBeNull();
  });

  it("resolves all three fixture sites", () => {
    expect(entities.sites).toHaveLength(3);
    expect(entities.sites.every((s) => s.protectionStatus === "unobserved")).toBe(true);
  });

  it("resolves all six fixture fire cells", () => {
    expect(entities.fireCells).toHaveLength(6);
    expect(entities.fireCells.filter((c) => c.stale)).toHaveLength(4);
    expect(entities.fireCells.filter((c) => !c.stale)).toHaveLength(2);
  });

  it("carries gridCellIndex/lastObservedAt through for inspection", () => {
    const freshCell = entities.fireCells.find((c) => c.gridCellIndex === 2891);
    expect(freshCell).toMatchObject({
      gridCellIndex: 2891,
      lastObservedAt: 85_000,
      stale: false,
    });
  });

  it("resolves a contradicted cell (two reports for the same edge+index) to the freshest one only", () => {
    const olderReport = fixtureCoordinatorView.observedCells[0]!; // fire-patch-1 cell 0, burning, stale, t=0
    const contradicting = {
      ...olderReport,
      burnState: "unburned" as const,
      lastObservedAt: 92_000 as never,
      stale: false,
      observerAgentId: "crew-1" as never,
    };
    const view = {
      ...fixtureCoordinatorView,
      observedCells: [olderReport, contradicting],
    };
    const result = buildSceneEntities(view, scenarioMap);
    const matching = result.fireCells.filter((c) => c.gridCellIndex === olderReport.gridCellIndex);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ burnState: "unburned", lastObservedAt: 92_000, stale: false });
  });

  it("is order-independent when resolving a contradiction (freshest wins regardless of array order)", () => {
    const olderReport = fixtureCoordinatorView.observedCells[0]!;
    const contradicting = {
      ...olderReport,
      burnState: "unburned" as const,
      lastObservedAt: 92_000 as never,
      stale: false,
    };
    const view = {
      ...fixtureCoordinatorView,
      observedCells: [contradicting, olderReport], // fresher one listed first this time
    };
    const result = buildSceneEntities(view, scenarioMap);
    const matching = result.fireCells.filter((c) => c.gridCellIndex === olderReport.gridCellIndex);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.burnState).toBe("unburned");
  });

  it("skips agents/sites/cells whose id isn't in the scene map", () => {
    const viewWithUnknownIds = {
      ...fixtureCoordinatorView,
      agents: [
        {
          ...fixtureCoordinatorView.agents[0]!,
          position: { kind: "node" as const, nodeId: "unknown-node" as never },
        },
      ],
      sites: [{ ...fixtureCoordinatorView.sites[0]!, nodeId: "unknown-node" as never }],
      observedCells: [],
    };
    const result = buildSceneEntities(viewWithUnknownIds, scenarioMap);
    expect(result.agents).toHaveLength(0);
    expect(result.sites).toHaveLength(0);
    expect(result.fireCells).toHaveLength(0);
  });
});

describe("components/scene/sceneEntities - agents sharing a node", () => {
  const refuge = scenarioMap.nodes.get("n-rw")!;
  const atRefuge = (id: string, callsign: string) => ({
    ...fixtureCoordinatorView.agents[1]!, // crew-2, idle at the refuge
    id: id as never,
    callsign,
  });

  it("fans agents out beside the node instead of stacking them on the model", () => {
    const view = { ...fixtureCoordinatorView, agents: [atRefuge("a", "Crew A"), atRefuge("b", "Crew B")] };
    const { agents } = buildSceneEntities(view, scenarioMap);
    expect(agents).toHaveLength(2);
    const [a, b] = agents;
    expect(Math.hypot(a!.position.x - b!.position.x, a!.position.z - b!.position.z)).toBeGreaterThan(20);
    for (const agent of agents) {
      expect(Math.hypot(agent.position.x - refuge.x, agent.position.z - refuge.z)).toBeCloseTo(NODE_CLEARANCE);
    }
  });

  it("does not move agents that are on a road", () => {
    const { agents } = buildSceneEntities(fixtureCoordinatorView, scenarioMap);
    const crew1 = agents.find((a) => a.id === "crew-1")!;
    expect(crew1.heading).not.toBeNull();
    const direct = buildSceneEntities({ ...fixtureCoordinatorView, agents: [fixtureCoordinatorView.agents[0]!] }, scenarioMap);
    expect(direct.agents[0]!.position).toEqual(crew1.position);
  });
});

describe("components/scene/sceneEntities - agent display state", () => {
  const crewState = (phase: "approach" | "work" | "return" | null) => {
    const crew1 = fixtureCoordinatorView.agents.find((a) => a.id === "crew-1")!;
    const plan = fixtureCoordinatorView.agentPlans[0]!;
    const view = {
      ...fixtureCoordinatorView,
      agents: [{ ...crew1, state: "approaching" as const }],
      agentPlans: phase === null ? [] : [{ ...plan, phase }],
    };
    return buildSceneEntities(view, scenarioMap).agents[0]!.state;
  };

  it("shows a crew on its return leg as returning, not approaching (the domain state has no returning)", () => {
    expect(crewState("return")).toBe("returning");
    expect(crewState("approach")).toBe("approaching");
    expect(crewState(null)).toBe("approaching");
  });
});

describe("components/scene/sceneEntities - firebreaks", () => {
  it("has none when the view carries none", () => {
    expect(buildSceneEntities(fixtureCoordinatorView, scenarioMap).firebreaks).toEqual([]);
  });

  it("places one marker per firebreak cell at that cell's centre", () => {
    const entities = buildSceneEntities({ ...fixtureCoordinatorView, firebreakCells: [1576, 1640] }, scenarioMap);
    expect(entities.firebreaks.map((cell) => cell.gridCellIndex)).toEqual([1576, 1640]);
    const [a, b] = entities.firebreaks;
    // One row apart in the grid: same scene x, different z.
    expect(a!.position.x).toBeCloseTo(b!.position.x, 6);
    expect(a!.position.z).not.toBeCloseTo(b!.position.z, 1);
  });
});

describe("components/scene/sceneEntities - fire line work", () => {
  it("splits a fire line into cleared, being-cleared and not-yet-started cells", () => {
    const entities = buildSceneEntities(
      {
        ...fixtureCoordinatorView,
        firebreakCells: [1576],
        clearingCells: [{ gridCellIndex: 1640, clearance: 0.5 }],
        firelines: [{ id: "line:1576~1768", start: { x: 1012.5, y: 612.5 }, end: { x: 1012.5, y: 687.5 }, cells: [1576, 1640, 1704, 1768], resolved: false }],
      },
      scenarioMap,
    );
    expect(entities.firebreaks.map((cell) => cell.gridCellIndex)).toEqual([1576]);
    expect(entities.clearing).toEqual([expect.objectContaining({ gridCellIndex: 1640, clearance: 0.5 })]);
    expect(entities.plannedLine.map((cell) => cell.gridCellIndex)).toEqual([1704, 1768]);
  });

  it("reads lines from their points and cells alone; no node ids are involved", () => {
    const line = { id: "line:1576~1768", start: { x: 1012.5, y: 612.5 }, end: { x: 1012.5, y: 687.5 }, cells: [1576, 1640, 1704, 1768], resolved: false };
    expect(Object.keys(line)).not.toContain("fromNodeId");
    const entities = buildSceneEntities({ ...fixtureCoordinatorView, firelines: [line] }, scenarioMap);
    expect(entities.plannedLine.map((cell) => cell.gridCellIndex)).toEqual([1576, 1640, 1704, 1768]);
    expect(entities.firebreaks).toEqual([]);
    expect(entities.clearing).toEqual([]);
  });

  it("lists a cell once, in order, when two lines share it", () => {
    const entities = buildSceneEntities(
      {
        ...fixtureCoordinatorView,
        firelines: [
          { id: "line:1576~1768", start: { x: 1012.5, y: 612.5 }, end: { x: 1012.5, y: 687.5 }, cells: [1768, 1704, 1640], resolved: false },
          { id: "line:1640~1642", start: { x: 1012.5, y: 637.5 }, end: { x: 1112.5, y: 637.5 }, cells: [1640, 1641, 1642], resolved: false },
        ],
      },
      scenarioMap,
    );
    expect(entities.plannedLine.map((cell) => cell.gridCellIndex)).toEqual([1640, 1641, 1642, 1704, 1768]);
  });

  it("shows no planned tiles for a resolved line, even where the fire took cells", () => {
    const entities = buildSceneEntities(
      {
        ...fixtureCoordinatorView,
        firebreakCells: [1576],
        firelines: [{ id: "line:1576~1768", start: { x: 1012.5, y: 612.5 }, end: { x: 1012.5, y: 687.5 }, cells: [1576, 1640, 1704, 1768], resolved: true }],
      },
      scenarioMap,
    );
    expect(entities.firebreaks.map((cell) => cell.gridCellIndex)).toEqual([1576]);
    expect(entities.plannedLine).toEqual([]);
  });
});
