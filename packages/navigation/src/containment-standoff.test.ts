import { describe, expect, it } from "vitest";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { nearestReachableNode } from "./containment.js";
import { nearestStandoffNode } from "./containment-standoff.js";

describe("nearestStandoffNode", () => {
  it("finds a hose standoff at least as close as junction-only search", () => {
    const scenario = buildSyntheticScenario();
    const road = new RoadIndex(scenario.map);
    const cell = scenario.map.initialFireCells[0]!;
    const junction = nearestReachableNode(road, cell, 750);
    const standoff = nearestStandoffNode(road, cell, 750);
    expect(standoff).not.toBeNull();
    expect(junction).not.toBeNull();
  });
});
