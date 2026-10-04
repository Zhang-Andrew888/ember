import { describe, expect, it } from "vitest";
import { AgentId, MissionPlan, NodeId } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario, type SimInput } from "./index.js";
import { RoadIndex, SIM_DEFAULTS, cellIndexOf, firelineCells, firelineId, reachableFirelineCells } from "./model/index.js";

const scenario = (() => {
  const base = buildSyntheticScenario({ agents: ["crew-1", "crew-2"], sites: ["site-a"] });
  // Fire far from the line along y = 800, under a calm spread.
  const far = [cellIndexOf(30, 1500)!, cellIndexOf(55, 1500)!];
  return { ...base, map: { ...base.map, initialFireCells: far } };
})();
const road = new RoadIndex(scenario.map);
const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };
const crew1 = AgentId.parse("crew-1");
const crew2 = AgentId.parse("crew-2");
const RW = NodeId.parse("n-rw");
const J1 = NodeId.parse("n-j1");
const pt = (node: NodeId) => road.nodePoint(node);

/** A line-building plan: optional approach edges, then `workMs` of clearing from `from` toward `to`. */
function lineOrder(inc: Incident, agentId: AgentId, approach: string[], from: NodeId, to: NodeId, workMs: number, departMs = 0): SimInput {
  const order = authoredCommit({
    road,
    agentId,
    planId: `plan-${agentId}-${from}`,
    knowledgeRevision: inc.agentRevision(agentId),
    startNode: RW,
    departMs,
    approach,
    workSiteId: null,
    workMs,
    back: [],
  });
  return { ...order, plan: MissionPlan.parse({ ...order.plan, work: { kind: "build_line", workNodeId: from, start: pt(from), end: pt(to) } }) };
}

describe("fire line geometry", () => {
  it("runs cell by cell from one node to the other, with one id for both directions", () => {
    const cells = firelineCells(pt(RW), pt(J1));
    expect(cells[0]).toBe(cellIndexOf(100, 800));
    expect(cells[cells.length - 1]).toBe(cellIndexOf(400, 800));
    for (let i = 1; i < cells.length; i++) {
      const [a, b] = [cells[i - 1]!, cells[i]!];
      expect(Math.max(Math.abs((a % 64) - (b % 64)), Math.abs(Math.floor(a / 64) - Math.floor(b / 64)))).toBe(1);
    }
    expect(firelineCells(pt(J1), pt(RW))).toEqual([...cells].reverse());
    expect(firelineId(pt(RW), pt(J1))).toBe(firelineId(pt(J1), pt(RW)));
  });

  it("limits each crew to the cells within reach of its own end", () => {
    const [h, n] = [NodeId.parse("n-h"), NodeId.parse("n-n")];
    const longLine = firelineCells(pt(h), pt(n));
    const reach = reachableFirelineCells(road, h, pt(h), pt(n));
    expect(reach.length).toBeLessThan(longLine.length);
    expect(reach).toEqual(longLine.slice(0, reach.length));
    expect(SIM_DEFAULTS.lineReachM).toBe(400);
  });
});

describe("building a fire line", () => {
  it("clears from both ends with two crews, each starting on its own, until the line is complete", () => {
    const inc = new Incident({ scenario, seed: "line-1", overrides: calm });
    // Crew 1 starts at once from Refuge West; Crew 2 drives to West Junction first.
    inc.submit(lineOrder(inc, crew1, [], RW, J1, 150_000));
    inc.submit(lineOrder(inc, crew2, ["e-rw-j1"], J1, RW, 150_000));
    // Mid-cell for Crew 1; Crew 2 is still on the road (it arrives at 75 s).
    inc.advanceTo(67_000);
    const early = inc.projectCoordinator();
    const westEnd = cellIndexOf(150, 800)!;
    const eastEnd = cellIndexOf(375, 800)!;
    expect(early.firebreakCells).toContain(westEnd);
    expect(early.firebreakCells ?? []).not.toContain(eastEnd);
    expect(early.clearingCells?.length).toBe(1);
    expect(early.firelines).toEqual([expect.objectContaining({ id: firelineId(pt(RW), pt(J1)), resolved: false })]);

    inc.advanceTo(240_000);
    const done = inc.projectCoordinator();
    expect(done.firebreakCells).toContain(eastEnd);
    expect(done.firelines?.[0]?.resolved).toBe(true);
    const fire = new Set([...(done.currentFire?.burningCells ?? []), ...(done.currentFire?.burnedCells ?? [])]);
    for (const cell of firelineCells(pt(RW), pt(J1))) expect(fire.has(cell)).toBe(false);
  });

  it("rejects line work that does not start at the line's starting node", () => {
    const inc = new Incident({ scenario, seed: "line-2", overrides: calm });
    inc.submit(lineOrder(inc, crew1, [], J1, RW, 60_000));
    inc.advanceTo(2_000);
    expect(inc.notices.some((n) => n.kind === "plan_rejected" && n.reason === "fireline_work_not_at_start_node")).toBe(true);
  });
});
