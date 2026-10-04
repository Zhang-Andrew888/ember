import { describe, expect, it } from "vitest";
import { AgentId, EdgeId, NodeId } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { certifyPlan, makeEnsemble, planDirectionalMove, type PlanningContext } from "./index.js";

const map = buildSyntheticScenario().map;
const road = new RoadIndex(map);
const directive = { direction: "north", maxDistanceMeters: 600, stopRule: "safe_road_node" } as const;

function context(closedCells: ReadonlySet<number> = new Set()): PlanningContext {
  return {
    agentId: AgentId.parse("crew-1"),
    road,
    ensemble: makeEnsemble(map, [{ id: "safe" }]),
    closedCells,
    position: { kind: "node", nodeId: NodeId.parse("n-rw") },
    nowMs: 0,
  };
}

describe("directional road movement", () => {
  it("plans northward travel to a safe node with a certified return", () => {
    const ctx = context();
    const result = planDirectionalMove(ctx, directive);
    expect(result.best?.target.nodeId).toBe("n-n");
    const plan = result.plan!;
    expect(plan.timedLegs.length).toBeGreaterThan(2);
    expect(certifyPlan({ road, ensemble: ctx.ensemble, closedCells: ctx.closedCells, plan, position: ctx.position, legIndex: 0, nowMs: 0 }).ok).toBe(true);
  });

  it("refuses when the only northward road is closed or outside the bound", () => {
    const closed = new Set(road.mustEdge(EdgeId.parse("e-j1-n")).cells.map((cell) => cell.cell));
    expect(planDirectionalMove(context(closed), directive).limitingReason).toBe("no_safe_directional_route");
    expect(planDirectionalMove(context(), { ...directive, maxDistanceMeters: 100 }).limitingReason).toBe("no_road_node_in_direction");
  });
});
