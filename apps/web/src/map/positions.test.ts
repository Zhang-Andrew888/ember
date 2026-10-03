import { describe, it, expect } from "vitest";
import { scenarioMap } from "./activeScenario.js";
import {
  resolveNodePosition,
  resolveEdgePoint,
  resolveEdgeHeading,
  resolveEdgePolyline,
  resolveAgentPosition,
  resolveGridCellPosition,
} from "./positions.js";

describe("map/positions - resolveNodePosition", () => {
  it("resolves a known refuge node into scene units", () => {
    // n-rw is (100, 800) m in a 1600 m world mapped onto 1400 scene units.
    expect(resolveNodePosition(scenarioMap, "n-rw")).toEqual({ x: -612.5, z: 0 });
  });

  it("returns null for an unknown node id", () => {
    expect(resolveNodePosition(scenarioMap, "does-not-exist")).toBeNull();
  });
});

describe("map/positions - resolveEdgePoint", () => {
  const edgeId = "e-rw-j1"; // (100,800) -> (400,800), 300 m

  it("resolves the start of an edge at distance 0", () => {
    expect(resolveEdgePoint(scenarioMap, edgeId, 0)).toEqual({ x: -612.5, z: 0 });
  });

  it("resolves a midpoint proportionally to distance in metres", () => {
    const point = resolveEdgePoint(scenarioMap, edgeId, 150);
    expect(point?.x).toBeCloseTo(-481.25);
    expect(point?.z).toBeCloseTo(0);
  });

  it("follows interior polyline points (e-rs-sc bends at (1000, 250))", () => {
    const edge = scenarioMap.edges.get("e-rs-sc")!;
    const firstLeg = edge.cumulativeMeters[1]!;
    const bend = resolveEdgePoint(scenarioMap, "e-rs-sc", firstLeg);
    expect(bend?.x).toBeCloseTo((1000 - 800) * 0.875);
    expect(bend?.z).toBeCloseTo((250 - 800) * 0.875);
    // Past the bend the point is on the second leg, not the straight chord.
    const after = resolveEdgePoint(scenarioMap, "e-rs-sc", firstLeg + 50)!;
    expect(after.x).toBeGreaterThan(bend!.x);
  });

  it("clamps distances beyond the edge length instead of throwing", () => {
    expect(resolveEdgePoint(scenarioMap, edgeId, 10_000)).toEqual({ x: -350, z: 0 });
  });

  it("returns null for an unknown edge id", () => {
    expect(resolveEdgePoint(scenarioMap, "unknown-edge", 10)).toBeNull();
  });
});

describe("map/positions - resolveEdgeHeading", () => {
  it("points from the edge start toward its end when forward", () => {
    const heading = resolveEdgeHeading(scenarioMap, "e-rw-j1", "forward");
    expect(heading?.dx).toBeCloseTo(1);
    expect(heading?.dz).toBeCloseTo(0);
  });

  it("flips direction when reverse", () => {
    const forward = resolveEdgeHeading(scenarioMap, "e-rs-s", "forward");
    const reverse = resolveEdgeHeading(scenarioMap, "e-rs-s", "reverse");
    expect(reverse?.dx).toBeCloseTo(-(forward?.dx ?? 0));
    expect(reverse?.dz).toBeCloseTo(-(forward?.dz ?? 0));
  });

  it("uses the heading of the leg the agent is on", () => {
    const edge = scenarioMap.edges.get("e-rs-sc")!;
    const early = resolveEdgeHeading(scenarioMap, "e-rs-sc", "forward", 1)!;
    const late = resolveEdgeHeading(scenarioMap, "e-rs-sc", "forward", edge.lengthMeters - 1)!;
    expect(early.dz / early.dx).toBeCloseTo(150 / 200); // (800,100) -> (1000,250)
    expect(late.dz / late.dx).toBeCloseTo(300 / 200); // (1000,250) -> (1200,550)
  });
});

describe("map/positions - resolveEdgePolyline", () => {
  it("returns all points in travel order and reversed for reverse", () => {
    const forward = resolveEdgePolyline(scenarioMap, "e-rs-sc", "forward")!;
    const reverse = resolveEdgePolyline(scenarioMap, "e-rs-sc", "reverse")!;
    expect(forward).toHaveLength(3);
    expect(reverse[0]).toEqual(forward[2]);
  });
});

describe("map/positions - resolveAgentPosition", () => {
  it("resolves a node-kind position", () => {
    const point = resolveAgentPosition(scenarioMap, { kind: "node", nodeId: "n-rw" as never } as never);
    expect(point).toEqual({ x: -612.5, z: 0 });
  });

  it("resolves an edge-kind position", () => {
    const point = resolveAgentPosition(scenarioMap, {
      kind: "edge",
      edgeId: "e-rs-s" as never,
      distanceAlongPolyline: 200 as never,
      direction: "forward",
      turnaroundTimeRemaining: 0 as never,
    } as never);
    expect(point).not.toBeNull();
  });
});

describe("map/positions - resolveGridCellPosition", () => {
  it("maps grid index 0 to scene coordinates", () => {
    expect(resolveGridCellPosition(0)).toEqual({ x: -689.0625, z: -689.0625 });
  });

  it("maps a fixture fire cell index", () => {
    expect(resolveGridCellPosition(1203)).toMatchObject({ x: expect.any(Number), z: expect.any(Number) });
  });
});
