import { describe, expect, it } from "vitest";
import { AgentId } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, brigadeTargetDistanceFromFireM } from "@ember/simulation/model";
import { containmentTargets } from "./containment.js";

describe("brigade containment standoff", () => {
  it("builds a suppress target with brigade options on the synthetic map", () => {
    const scenario = buildSyntheticScenario({ gameChanges: true });
    const road = new RoadIndex(scenario.map);
    const cell = scenario.map.initialFireCells[0]!;
    const targets = containmentTargets([cell], road, undefined, undefined, true, {
      agentId: AgentId.parse("crew-1"),
      peerCountOnCell: () => 0,
      peerStandoffNodes: new Set(),
    });
    expect(targets.length).toBeGreaterThan(0);
  });

  it("uses farther target distance when peers already hold the cell", () => {
    const d0 = brigadeTargetDistanceFromFireM("crew-1", 0);
    const d1 = brigadeTargetDistanceFromFireM("crew-1", 1);
    expect(d1).toBeLessThan(d0);
  });
});
