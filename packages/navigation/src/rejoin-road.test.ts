import { describe, expect, it } from "vitest";
import { AgentId, NodeId, type AgentPosition } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, cellIndexOf } from "@ember/simulation/model";
import { makeEnsemble, planRejoinRoad, type PlanningContext } from "./index.js";

const scenario = buildSyntheticScenario();
const map = scenario.map;
const road = new RoadIndex(map);
const offroad: AgentPosition = { kind: "offroad", start: { x: 700, y: 600 }, end: { x: 720, y: 620 }, progress: 1 };

function ctx(over: Partial<PlanningContext> = {}): PlanningContext {
  return {
    agentId: AgentId.parse("crew-1"),
    road,
    closedCells: new Set(),
    position: offroad,
    nowMs: 10_000,
    ensemble: makeEnsemble(map, [{ id: "a" }]),
    ...over,
  };
}

function nearestNode(x: number, y: number): string {
  return [...road.nodes.values()].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]!.id;
}

describe("rejoin road from off-road", () => {
  it("drives straight from the crew's point to the nearest road node", () => {
    const result = planRejoinRoad(ctx());
    expect(result.feasible).toBe(true);
    const leg = result.plan!.offroadLegs![0]!;
    expect(leg.start).toEqual({ x: 720, y: 620 });
    const node = road.nodePoint(NodeId.parse(nearestNode(720, 620)));
    expect(leg.end).toEqual({ x: node.x, y: node.y });
    expect(result.plan!.refugeId).toBe(nearestNode(720, 620));
    expect(leg.departMs).toBe(10_000);
    expect(leg.arriveMs).toBeGreaterThan(10_000);
  });

  it("picks another node when the straight line crosses known fire", () => {
    const first = planRejoinRoad(ctx()).plan!.offroadLegs![0]!;
    const midCell = cellIndexOf((first.start.x + first.end.x) / 2, (first.start.y + first.end.y) / 2)!;
    const result = planRejoinRoad(ctx({ closedCells: new Set([midCell]) }));
    if (result.plan !== null) expect(result.plan.offroadLegs![0]!.end).not.toEqual(first.end);
  });

  it("does nothing for a crew already on the road network", () => {
    expect(planRejoinRoad(ctx({ position: { kind: "node", nodeId: NodeId.parse("n-rw") } })).feasible).toBe(false);
  });
});
