import { describe, expect, it } from "vitest";
import { scenarioMap } from "./scenarioMap.js";

describe("scenarioMap", () => {
  it("has no duplicate node ids", () => {
    const ids = [...scenarioMap.nodes.keys()];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate edge ids", () => {
    const ids = [...scenarioMap.edges.keys()];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every edge references existing nodes at both ends", () => {
    for (const edge of scenarioMap.edges.values()) {
      expect(scenarioMap.nodes.has(edge.fromNodeId), `${edge.id} fromNodeId ${edge.fromNodeId}`).toBe(true);
      expect(scenarioMap.nodes.has(edge.toNodeId), `${edge.id} toNodeId ${edge.toNodeId}`).toBe(true);
    }
  });

  it("no edge connects a node to itself", () => {
    for (const edge of scenarioMap.edges.values()) {
      expect(edge.fromNodeId).not.toBe(edge.toNodeId);
    }
  });

  it("every edge has a positive length and at least one fire cell", () => {
    for (const edge of scenarioMap.edges.values()) {
      expect(edge.lengthMeters).toBeGreaterThan(0);
      expect(edge.cellCount).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(edge.cellCount)).toBe(true);
    }
  });

  it("every refuge/site node has a label, and junctions have none", () => {
    for (const node of scenarioMap.nodes.values()) {
      if (node.kind === "junction") {
        expect(node.label).toBeUndefined();
      } else {
        expect(node.label).toBeTruthy();
      }
    }
  });
});
