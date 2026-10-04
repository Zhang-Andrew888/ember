import { describe, expect, it } from "vitest";
import { AgentId, NodeId, type AgentPosition } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, SIM_DEFAULTS, firelineCells } from "@ember/simulation/model";
import { firelineTarget, makeEnsemble, planLineFromField, planMissions, type PlanningContext } from "./index.js";

const scenario = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"], gameChanges: true });
const road = new RoadIndex(scenario.map);
const N = NodeId.parse("n-n");

function ctx(position: AgentPosition): PlanningContext {
  return {
    agentId: AgentId.parse("crew-1"),
    road,
    closedCells: new Set(),
    position,
    nowMs: 0,
    ensemble: makeEnsemble(scenario.map, [{ id: "a" }]),
    diagnose: false,
    gameChanges: true,
  };
}

describe("game-changes fire lines", () => {
  const start = { x: 600, y: 1000 };
  const end = { x: 800, y: 1000 };

  it("takes an end far from any road and plans the whole line, walked on foot", () => {
    const far = { x: 900, y: 1450 };
    expect(firelineTarget(road, far, { x: 1100, y: 1450 }).ok).toBe(false);
    const planned = firelineTarget(road, far, { x: 1100, y: 1450 }, 1, undefined, true);
    if (!planned.ok) throw new Error("a road node is within off-road range");
    const cells = firelineCells(far, { x: 1100, y: 1450 }).length;
    const walkMs = (200 / SIM_DEFAULTS.agentSpeedMps) * 1000;
    expect(planned.target.workOptionsMs.at(-1)).toBeGreaterThanOrEqual(cells * SIM_DEFAULTS.lineWorkPerCell * 1000 + walkMs);
  });

  it("drives off-road from the nearest road node to the line end, with no return leg", () => {
    const planned = firelineTarget(road, start, end, 1, undefined, true);
    if (!planned.ok) throw new Error("n-n is in range");
    expect(planned.target.nodeId).toBe(N);
    const result = planMissions(ctx({ kind: "node", nodeId: N }), [planned.target]);
    const plan = result.best!.plan;
    expect(plan.timedLegs).toEqual([]);
    expect(plan.offroadLegs).toHaveLength(1);
    expect(plan.offroadLegs![0]!.end).toEqual(start);
    expect(plan.workInterval.startMs).toBe(plan.offroadLegs![0]!.arriveMs);
    expect(plan.work).toEqual({ kind: "build_line", workNodeId: N, start, end });
  });

  it("drives straight to the line end when the crew is already off-road", () => {
    const planned = firelineTarget(road, start, end, 1, undefined, true);
    if (!planned.ok) throw new Error("n-n is in range");
    const here = { x: 650, y: 900 };
    const result = planLineFromField(ctx({ kind: "offroad", start: { x: 640, y: 880 }, end: here, progress: 1 }), planned.target);
    const plan = result.best!.plan;
    expect(plan.timedLegs).toEqual([]);
    expect(plan.offroadLegs).toEqual([expect.objectContaining({ start: here, end: start })]);
    expect(plan.workInterval.endMs - plan.workInterval.startMs).toBe(planned.target.workOptionsMs.at(-1));
  });
});
