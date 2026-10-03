import { describe, it, expect } from "vitest";
import { fixtureCoordinatorView as rawFixture } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { adaptToScenarioIds } from "../../net/mockBase.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { buildSceneEntities, listRefugeNodes } from "./sceneEntities.js";

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

  it("resolves all three fixture agents", () => {
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
