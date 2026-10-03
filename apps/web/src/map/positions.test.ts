import { describe, it, expect } from "vitest";
import { scenarioMap } from "./scenarioMap.js";
import {
  resolveNodePosition,
  resolveEdgePoint,
  resolveEdgeHeading,
  resolveAgentPosition,
  resolveCellPosition,
} from "./positions.js";

describe("map/positions - resolveNodePosition", () => {
  it("resolves a known refuge node", () => {
    expect(resolveNodePosition(scenarioMap, "placeholder-node-refuge-west")).toEqual({
      x: -260,
      z: 20,
    });
  });

  it("returns null for an unknown node id", () => {
    expect(resolveNodePosition(scenarioMap, "does-not-exist")).toBeNull();
  });
});

describe("map/positions - resolveEdgePoint", () => {
  const edgeId = "placeholder-edge-refuge-west-site-a";

  it("resolves the start of an edge at distance 0", () => {
    expect(resolveEdgePoint(scenarioMap, edgeId, 0)).toEqual({ x: -260, z: 20 });
  });

  it("resolves a midpoint proportionally to distance", () => {
    const point = resolveEdgePoint(scenarioMap, edgeId, 360);
    // fixture: crew-1 is 360m along this 500m edge
    const t = 360 / 500;
    expect(point?.x).toBeCloseTo(-260 + (180 - -260) * t);
    expect(point?.z).toBeCloseTo(20 + (60 - 20) * t);
  });

  it("clamps distances beyond the edge length instead of throwing", () => {
    expect(resolveEdgePoint(scenarioMap, edgeId, 10_000)).toEqual({ x: 180, z: 60 });
  });

  it("returns null for an unknown edge id", () => {
    expect(resolveEdgePoint(scenarioMap, "unknown-edge", 10)).toBeNull();
  });
});

describe("map/positions - resolveEdgeHeading", () => {
  it("points from the edge start toward its end when forward", () => {
    const heading = resolveEdgeHeading(scenarioMap, "placeholder-edge-refuge-west-site-a", "forward");
    expect(heading?.dx).toBeGreaterThan(0);
  });

  it("flips direction when reverse", () => {
    const forward = resolveEdgeHeading(scenarioMap, "placeholder-edge-refuge-west-site-a", "forward");
    const reverse = resolveEdgeHeading(scenarioMap, "placeholder-edge-refuge-west-site-a", "reverse");
    expect(reverse?.dx).toBeCloseTo(-(forward?.dx ?? 0));
    expect(reverse?.dz).toBeCloseTo(-(forward?.dz ?? 0));
  });
});

describe("map/positions - resolveAgentPosition", () => {
  it("resolves a node-kind position", () => {
    const point = resolveAgentPosition(scenarioMap, {
      kind: "node",
      nodeId: "placeholder-node-refuge-west" as never,
    } as never);
    expect(point).toEqual({ x: -260, z: 20 });
  });

  it("resolves an edge-kind position", () => {
    const point = resolveAgentPosition(scenarioMap, {
      kind: "edge",
      edgeId: "placeholder-edge-refuge-south-north-sector" as never,
      distanceAlongPolyline: 200 as never,
      direction: "forward",
      turnaroundTimeRemaining: 0 as never,
    } as never);
    expect(point).not.toBeNull();
  });
});

describe("map/positions - resolveCellPosition", () => {
  it("resolves the midpoint of cell 0 on a 2-cell edge", () => {
    const point = resolveCellPosition(scenarioMap, "placeholder-edge-fire-patch-1", 0);
    const expectedPoint = resolveEdgePoint(scenarioMap, "placeholder-edge-fire-patch-1", 20);
    expect(point).toEqual(expectedPoint);
  });

  it("resolves cell 3 on the north-spread edge referenced by the fixture", () => {
    expect(resolveCellPosition(scenarioMap, "placeholder-edge-north-spread-1", 3)).not.toBeNull();
  });

  it("returns null for an unknown edge", () => {
    expect(resolveCellPosition(scenarioMap, "unknown-edge", 0)).toBeNull();
  });
});
