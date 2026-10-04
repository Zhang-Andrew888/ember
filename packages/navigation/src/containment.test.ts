import { describe, expect, it } from "vitest";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { containmentTargets, nearestReachableNode } from "./containment.js";

describe("containmentTargets", () => {
  it("offers contain missions for observed burning cells near the road network", () => {
    const scenario = buildSyntheticScenario();
    const road = new RoadIndex(scenario.map);
    const cell = scenario.map.initialFireCells[0]!;
    expect(nearestReachableNode(road, cell)).not.toBeNull();
    const targets = containmentTargets([cell], road);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]?.kind).toBe("contain");
    expect(targets[0]?.gridCellIndex).toBe(cell);
  });
});
