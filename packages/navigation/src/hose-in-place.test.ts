import { describe, expect, it } from "vitest";
import { AgentId, NodeId, type AgentPosition } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, cellIndexOf } from "@ember/simulation/model";
import { containmentTargets, makeEnsemble, planHoseInPlace, type PlanningContext } from "./index.js";

const scenario = buildSyntheticScenario({ gameChanges: true });
const road = new RoadIndex(scenario.map);
const here = { x: 720, y: 620 };
const offroad: AgentPosition = { kind: "offroad", start: { x: 700, y: 600 }, end: here, progress: 1 };

function ctx(position: AgentPosition = offroad): PlanningContext {
  return {
    agentId: AgentId.parse("crew-1"),
    road,
    closedCells: new Set(),
    position,
    nowMs: 30_000,
    ensemble: makeEnsemble(scenario.map, [{ id: "a" }]),
    gameChanges: true,
  };
}

describe("hose in place", () => {
  const near = cellIndexOf(here.x + 60, here.y)!;
  const far = cellIndexOf(here.x + 400, here.y)!;

  it("works the nearest burning cell in reach without moving", () => {
    const result = planHoseInPlace(ctx(), containmentTargets([far, near], road, 1, undefined, true));
    expect(result.feasible).toBe(true);
    const plan = result.plan!;
    expect(plan.timedLegs).toEqual([]);
    expect(plan.offroadLegs).toEqual([]);
    expect(plan.work).toEqual({ kind: "suppress_fire", gridCellIndex: near });
    expect(plan.workInterval.startMs).toBe(30_000);
    expect(plan.workInterval.endMs).toBeGreaterThan(30_000);
  });

  it("does nothing when all known fire is beyond hose reach", () => {
    expect(planHoseInPlace(ctx(), containmentTargets([far], road, 1, undefined, true)).feasible).toBe(false);
  });

  it("is only for crews standing off-road", () => {
    const atNode: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-rw") };
    expect(planHoseInPlace(ctx(atNode), containmentTargets([near], road, 1, undefined, true)).feasible).toBe(false);
  });
});
