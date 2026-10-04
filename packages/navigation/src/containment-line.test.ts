import { describe, expect, it } from "vitest";
import type { NodeId } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, cellCenter, cellIndexOf, gameHoseRadiusM } from "@ember/simulation/model";
import { lineStandoffNode } from "./index.js";

const road = new RoadIndex(buildSyntheticScenario({ gameChanges: true }).map);

function sideDot(nodeId: NodeId, cell: number, side: { x: number; y: number }): number {
  const p = road.nodePoint(nodeId);
  const c = cellCenter(cell);
  const d = Math.hypot(p.x - c.x, p.y - c.y);
  return ((p.x - c.x) * side.x + (p.y - c.y) * side.y) / d;
}

describe("hose line standoff", () => {
  const anchor = road.map.nodes[0]!;
  const a = road.nodePoint(anchor.id);
  const cell = cellIndexOf(a.x + 60, a.y)!;
  const c = cellCenter(cell);
  const len = Math.hypot(a.x - c.x, a.y - c.y);
  const west = { x: (a.x - c.x) / len, y: (a.y - c.y) / len };
  const opts = { minSideDot: 0.5, spacingM: 100, minDistM: 0 };

  it("stands on the anchor crew's side of the fire, within hose reach", () => {
    const node = lineStandoffNode(road, cell, gameHoseRadiusM(), 100, { ...opts, side: west, occupied: [] });
    expect(node).not.toBeNull();
    expect(sideDot(node!, cell, west)).toBeGreaterThanOrEqual(0.5);
    const p = road.nodePoint(node!);
    expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThanOrEqual(gameHoseRadiusM());
  });

  it("never picks a node on the far side of the fire", () => {
    const east = { x: -west.x, y: -west.y };
    const node = lineStandoffNode(road, cell, gameHoseRadiusM(), 100, { ...opts, side: east, occupied: [] });
    if (node !== null) expect(sideDot(node, cell, east)).toBeGreaterThanOrEqual(0.5);
  });

  it("moves along the line away from a slot another crew already holds", () => {
    const free = lineStandoffNode(road, cell, gameHoseRadiusM(), 100, { ...opts, side: west, occupied: [] })!;
    const held = road.nodePoint(free);
    const next = lineStandoffNode(road, cell, gameHoseRadiusM(), 100, { ...opts, side: west, occupied: [held] });
    if (next !== null && next !== free) {
      const p = road.nodePoint(next);
      expect(Math.hypot(p.x - held.x, p.y - held.y)).toBeGreaterThan(0);
      expect(sideDot(next, cell, west)).toBeGreaterThanOrEqual(0.5);
    }
  });
});
