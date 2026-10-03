import { describe, it, expect } from "vitest";
import { fixtureCoordinatorView } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { scenarioMap } from "../../map/scenarioMap.js";
import { buildSceneEntities, listRefugeNodes } from "./sceneEntities.js";

describe("components/scene/sceneEntities - listRefugeNodes", () => {
  it("returns exactly the refuge-kind nodes", () => {
    const refuges = listRefugeNodes(scenarioMap);
    expect(refuges.map((r) => r.id).sort()).toEqual(
      ["placeholder-node-refuge-south", "placeholder-node-refuge-west"].sort(),
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
      observedCells: [{ ...fixtureCoordinatorView.observedCells[0]!, edgeId: "unknown-edge" }],
    };
    const result = buildSceneEntities(viewWithUnknownIds, scenarioMap);
    expect(result.agents).toHaveLength(0);
    expect(result.sites).toHaveLength(0);
    expect(result.fireCells).toHaveLength(0);
  });
});
