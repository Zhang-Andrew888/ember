import { describe, expect, it } from "vitest";
import { NodeId } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, SIM_DEFAULTS, firelineCells, reachableFirelineCells } from "@ember/simulation/model";
import { firelineTarget, nearestRoadNodeWithin } from "./firelines.js";

// Synthetic map road nodes (m): n-rw (100, 800), n-j1 (400, 800), n-h (1000, 800), n-sa (1200, 1050).
const road = new RoadIndex(buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] }).map);
const RW = NodeId.parse("n-rw");

describe("nearestRoadNodeWithin", () => {
  it("picks the nearest road node inside the reach", () => {
    expect(nearestRoadNodeWithin(road, { x: 150, y: 800 })).toBe(RW);
    expect(nearestRoadNodeWithin(road, { x: 390, y: 700 })).toBe("n-j1");
  });

  it("counts a node exactly at the reach limit and ignores one beyond it", () => {
    expect(nearestRoadNodeWithin(road, { x: 100, y: 800 + SIM_DEFAULTS.lineReachM })).toBe(RW);
    expect(nearestRoadNodeWithin(road, { x: 100, y: 800 + SIM_DEFAULTS.lineReachM + 1 })).not.toBe(RW);
  });

  it("returns null when no road node is in reach", () => {
    expect(nearestRoadNodeWithin(road, { x: 1500, y: 1500 })).toBeNull();
  });
});

describe("firelineTarget", () => {
  it("accepts an end near a road: works from the nearest node for every reachable cell", () => {
    const start = { x: 150, y: 800 };
    const end = { x: 150, y: 1100 };
    const result = firelineTarget(road, start, end);
    if (!result.ok) throw new Error(`unexpected refusal ${result.reason}`);
    const { target } = result;
    expect(target.kind).toBe("line");
    expect(target.nodeId).toBe(RW);
    expect(target.line).toEqual({ workNodeId: RW, start, end });
    const reachable = reachableFirelineCells(road, RW, start, end).length;
    expect(reachable).toBeGreaterThan(0);
    expect(target.workOptionsMs.at(-1)).toBe(reachable * SIM_DEFAULTS.lineWorkPerCell * 1000);
  });

  it("plans only the cells within reach of the work node on a line longer than the reach", () => {
    const start = { x: 100, y: 800 };
    const end = { x: 100, y: 1500 };
    const result = firelineTarget(road, start, end);
    if (!result.ok) throw new Error(`unexpected refusal ${result.reason}`);
    const all = firelineCells(start, end).length;
    const reachable = reachableFirelineCells(road, RW, start, end).length;
    expect(reachable).toBeLessThan(all);
    expect(result.target.workOptionsMs.at(-1)).toBe(reachable * SIM_DEFAULTS.lineWorkPerCell * 1000);
  });

  it("gives both directions of one line the same line id, with each crew on its own node", () => {
    const a = { x: 150, y: 800 };
    const b = { x: 1000, y: 850 };
    const fromA = firelineTarget(road, a, b);
    const fromB = firelineTarget(road, b, a);
    if (!fromA.ok || !fromB.ok) throw new Error("both ends are near a road");
    expect(fromA.target.id.split("@")[0]).toBe(fromB.target.id.split("@")[0]);
    expect(fromA.target.nodeId).toBe(RW);
    expect(fromB.target.nodeId).toBe("n-h");
  });

  it("refuses an end far from every road", () => {
    expect(firelineTarget(road, { x: 1500, y: 1500 }, { x: 1500, y: 1200 })).toEqual({
      ok: false,
      reason: "no_road_near_line_end",
    });
  });

  it("judges only the crew's own end: a far end is fine when the crew's end is near a road", () => {
    expect(firelineTarget(road, { x: 150, y: 800 }, { x: 1500, y: 1500 }).ok).toBe(true);
    expect(firelineTarget(road, { x: 1500, y: 1500 }, { x: 150, y: 800 }).ok).toBe(false);
  });
});
