import { describe, expect, it } from "vitest";
import { AgentId, MissionPlan, NodeId } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario, type SimInput } from "./index.js";
import { RoadIndex, SIM_DEFAULTS, cellCenter, cellIndexOf, firelineCells, firelineId, lineEnd, reachableFirelineCells } from "./model/index.js";

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
const H = NodeId.parse("n-h");
const pt = (node: NodeId) => road.nodePoint(node);

/**
 * A line-building plan: optional approach edges, then `workMs` of clearing from `start` toward `end`,
 * worked from road node `workNode`. Points default to the node positions.
 */
function pointOrder(
  inc: Incident,
  agentId: AgentId,
  approach: string[],
  workNode: NodeId,
  start: { x: number; y: number },
  end: { x: number; y: number },
  workMs: number,
  departMs = 0,
): SimInput {
  const order = authoredCommit({
    road,
    agentId,
    planId: `plan-${agentId}-${workNode}`,
    knowledgeRevision: inc.agentRevision(agentId),
    startNode: RW,
    departMs,
    approach,
    workSiteId: null,
    workMs,
    back: [],
  });
  return { ...order, plan: MissionPlan.parse({ ...order.plan, work: { kind: "build_line", workNodeId: workNode, start, end } }) };
}

/** The same order between two road nodes, worked from the first. */
const lineOrder = (inc: Incident, agentId: AgentId, approach: string[], from: NodeId, to: NodeId, workMs: number): SimInput =>
  pointOrder(inc, agentId, approach, from, pt(from), pt(to), workMs);

/** Cells inside Refuge West's protection area are never burnable, so crews have nothing to clear there. */
const toClear = (cells: readonly number[]): number[] =>
  cells
    .filter((c) => {
      const p = cellCenter(c);
      return Math.hypot(p.x - pt(RW).x, p.y - pt(RW).y) > SIM_DEFAULTS.refugeRadiusM;
    })
    .sort((a, b) => a - b);

const rejection = (inc: Incident) => inc.notices.find((n) => n.kind === "plan_rejected");

describe("fire line geometry", () => {
  it("runs cell by cell from one point to the other, with one id for both directions", () => {
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

  it("limits each crew to the cells within reach of its work node", () => {
    const longLine = firelineCells(pt(H), pt(NodeId.parse("n-n")));
    const reach = reachableFirelineCells(road, H, pt(H), pt(NodeId.parse("n-n")));
    expect(reach.length).toBeLessThan(longLine.length);
    expect(reach).toEqual(longLine.slice(0, reach.length));
    expect(SIM_DEFAULTS.lineReachM).toBe(400);
  });

  it("shortens a line heading west from Refuge West at the map edge", () => {
    const { end, clampedToEdge } = lineEnd(pt(RW), 270, 300);
    expect(clampedToEdge).toBe(true);
    expect(end).toEqual({ x: 0, y: 800 });
    expect(firelineCells(pt(RW), end)).toEqual([4, 3, 2, 1, 0].map((col) => 32 * 64 + col));
  });
});

describe("accepting a fire line plan", () => {
  it("rejects work at a node other than where the crew stands at work time", () => {
    const inc = new Incident({ scenario, seed: "line-r1", overrides: calm });
    // Crew 1 starts at Refuge West and has no approach, so it cannot work from West Junction.
    inc.submit(lineOrder(inc, crew1, [], J1, RW, 60_000));
    inc.advanceTo(2_000);
    expect(rejection(inc)).toMatchObject({ reason: "fireline_work_not_at_work_node" });

    // After an approach to West Junction it cannot work from Refuge West either.
    const inc2 = new Incident({ scenario, seed: "line-r2", overrides: calm });
    inc2.submit(lineOrder(inc2, crew1, ["e-rw-j1"], RW, J1, 60_000));
    inc2.advanceTo(2_000);
    expect(rejection(inc2)).toMatchObject({ reason: "fireline_work_not_at_work_node" });
    expect(inc2.projectCoordinator().firelines).toBeUndefined();
  });

  it("rejects a work node farther than the reach from the crew's line end", () => {
    const inc = new Incident({ scenario, seed: "line-r3", overrides: calm });
    // The crew stands at Refuge West (a valid work node) but its end of the line is 800 m east.
    inc.submit(pointOrder(inc, crew1, [], RW, { x: 900, y: 800 }, pt(RW), 60_000));
    inc.advanceTo(2_000);
    expect(rejection(inc)).toMatchObject({ reason: "fireline_end_out_of_reach" });
    expect(inc.projectCoordinator().firelines).toBeUndefined();
  });

  it("accepts a work node exactly within reach of the end, and rejects a line of one point", () => {
    const inc = new Incident({ scenario, seed: "line-r4", overrides: calm });
    // 300 m from West Junction to the end is inside the 400 m reach.
    inc.submit(pointOrder(inc, crew1, ["e-rw-j1"], J1, { x: 700, y: 800 }, pt(RW), 30_000));
    inc.advanceTo(2_000);
    expect(rejection(inc)).toBeUndefined();

    const inc2 = new Incident({ scenario, seed: "line-r5", overrides: calm });
    inc2.submit(pointOrder(inc2, crew1, [], RW, pt(RW), pt(RW), 30_000));
    inc2.advanceTo(2_000);
    expect(rejection(inc2)).toMatchObject({ reason: "fireline_needs_two_points" });
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
    expect(early.firelines).toEqual([
      expect.objectContaining({ id: firelineId(pt(RW), pt(J1)), start: pt(RW), end: pt(J1), resolved: false }),
    ]);

    inc.advanceTo(240_000);
    const done = inc.projectCoordinator();
    expect(done.firebreakCells).toContain(eastEnd);
    expect(done.firelines?.[0]?.resolved).toBe(true);
    expect(inc.notices.filter((n) => n.kind === "fireline_resolved")).toEqual([
      expect.objectContaining({ lineId: firelineId(pt(RW), pt(J1)), outcome: "complete" }),
    ]);
    const fire = new Set([...(done.currentFire?.burningCells ?? []), ...(done.currentFire?.burnedCells ?? [])]);
    for (const cell of firelineCells(pt(RW), pt(J1))) expect(fire.has(cell)).toBe(false);
  });

  it("registers one line, in canonical order, whichever end's crew is committed first", () => {
    const inc = new Incident({ scenario, seed: "line-2", overrides: calm });
    inc.submit(lineOrder(inc, crew2, ["e-rw-j1"], J1, RW, 30_000));
    inc.submit(lineOrder(inc, crew1, [], RW, J1, 30_000));
    inc.advanceTo(1_000);
    const lines = inc.projectCoordinator().firelines ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ start: pt(RW), end: pt(J1) });
    expect(lines[0]?.cells).toEqual(firelineCells(pt(RW), pt(J1)));
  });

  it("meets in the middle: two crews from opposite ends finish a line one crew cannot", () => {
    const longEnd = { x: 700, y: 800 };
    const total = firelineCells(pt(RW), longEnd).length;
    const submitBoth = (inc: Incident) => {
      inc.submit(pointOrder(inc, crew1, [], RW, pt(RW), longEnd, 280_000));
      inc.submit(pointOrder(inc, crew2, ["e-rw-j1"], J1, longEnd, pt(RW), 280_000));
    };
    const pair = new Incident({ scenario, seed: "line-3", overrides: calm });
    submitBoth(pair);
    pair.advanceTo(150_000);
    expect(pair.projectCoordinator().firelines?.[0]?.resolved).toBe(false);
    pair.advanceTo(260_000);
    const done = pair.projectCoordinator();
    expect(done.firelines?.[0]?.resolved).toBe(true);
    expect(done.firebreakCells).toEqual(toClear(firelineCells(pt(RW), longEnd)));
    expect(done.clearingCells).toBeUndefined();
    expect(total).toBe(25);

    // Crew 1 alone reaches only the cells within 400 m of Refuge West, however long it works.
    const solo = new Incident({ scenario, seed: "line-3", overrides: calm });
    solo.submit(pointOrder(solo, crew1, [], RW, pt(RW), longEnd, 600_000));
    solo.advanceTo(500_000);
    const view = solo.projectCoordinator();
    const reachable = toClear(reachableFirelineCells(road, RW, pt(RW), longEnd));
    expect(reachable.length).toBeLessThan(total);
    expect(view.firebreakCells).toEqual(reachable);
    expect(view.firelines?.[0]?.resolved).toBe(false);
  });

  it("clears a line shortened at the map edge and resolves it", () => {
    const { end, clampedToEdge } = lineEnd(pt(RW), 270, 300);
    expect(clampedToEdge).toBe(true);
    const inc = new Incident({ scenario, seed: "line-4", overrides: calm });
    inc.submit(pointOrder(inc, crew1, [], RW, pt(RW), end, 120_000));
    inc.advanceTo(100_000);
    const view = inc.projectCoordinator();
    const cells = firelineCells(pt(RW), end);
    expect(cells).toHaveLength(5);
    // The refuge protects the first three cells; the crew clears the two beyond it, out to x = 0.
    expect(view.firebreakCells).toEqual(toClear(cells));
    expect(toClear(cells)).toHaveLength(2);
    expect(view.firelines).toEqual([
      expect.objectContaining({ id: firelineId(pt(RW), end), start: end, end: pt(RW), cells: [...cells].reverse(), resolved: true }),
    ]);
    expect(inc.notices.some((n) => n.kind === "fireline_resolved" && n.outcome === "complete")).toBe(true);
  });
});

describe("fire line determinism", () => {
  it("gives the same views twice for a two-crew line run", () => {
    const run = () => {
      const inc = new Incident({ scenario, seed: "line-det", overrides: calm });
      const end = { x: 700, y: 800 };
      inc.submit(pointOrder(inc, crew1, [], RW, pt(RW), end, 250_000));
      inc.submit(pointOrder(inc, crew2, ["e-rw-j1"], J1, end, pt(RW), 250_000));
      const views: string[] = [];
      for (const t of [50_000, 100_000, 150_000, 200_000, 250_000]) {
        inc.advanceTo(t);
        views.push(JSON.stringify(inc.projectCoordinator()));
      }
      return { views, notices: JSON.stringify(inc.notices) };
    };
    expect(run()).toEqual(run());
  });
});
