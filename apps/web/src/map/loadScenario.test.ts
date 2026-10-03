import { describe, expect, it } from "vitest";
import { loadScenarioMap } from "./loadScenario.js";
import snapshot from "./synthetic-v1.snapshot.json";
import placeholder from "../../../../scenarios/scenario-v1.placeholder.json";
import { scenarioMap } from "./activeScenario.js";

const fallback = { name: "snap.json", data: snapshot };

describe("loadScenarioMap", () => {
  it("skips the PENDING placeholder in scenarios/ and falls back to the snapshot, reporting why", () => {
    const map = loadScenarioMap({ "scenario-v1.placeholder.json": placeholder }, fallback);
    expect(map.source.kind).toBe("local-snapshot");
    expect(map.source.skipped).toHaveLength(1);
    expect(map.source.skipped[0]?.name).toBe("scenario-v1.placeholder.json");
  });

  it("prefers a valid scenarios/ file over the snapshot", () => {
    const map = loadScenarioMap({ "a.json": snapshot }, { name: "other", data: null });
    expect(map.source).toMatchObject({ kind: "scenarios-dir", name: "a.json" });
  });

  it("picks the first valid file by name and ignores null (unparseable) files", () => {
    const map = loadScenarioMap({ "z.json": snapshot, "a.json": null }, fallback);
    expect(map.source.name).toBe("z.json");
    expect(map.source.skipped.map((s) => s.name)).toEqual(["a.json"]);
  });

  it("rejects an edge that references an unknown node", () => {
    const broken = structuredClone(snapshot);
    broken.map.edges[0]!.to = "ghost";
    const map = loadScenarioMap({ "broken.json": broken }, fallback);
    expect(map.source.kind).toBe("local-snapshot");
    expect(map.source.skipped[0]?.reason).toContain("ghost");
  });

  it("rejects terrain arrays of the wrong size", () => {
    const broken = structuredClone(snapshot);
    broken.terrain.height = broken.terrain.height.slice(1);
    expect(loadScenarioMap({ "broken.json": broken }, fallback).source.kind).toBe("local-snapshot");
  });

  it("never carries requiredWork through, even if a file has it", () => {
    const withTruth = structuredClone(snapshot) as unknown as { map: { sites: Record<string, unknown>[] } };
    withTruth.map.sites[0]!.requiredWork = 300;
    const map = loadScenarioMap({ "t.json": withTruth }, fallback);
    expect(JSON.stringify([...map.nodes.values(), ...map.edges.values()])).not.toContain("requiredWork");
  });
});

describe("active scenario map", () => {
  it("has unique, well-formed topology", () => {
    expect(scenarioMap.nodes.size).toBeGreaterThan(5);
    for (const edge of scenarioMap.edges.values()) {
      expect(scenarioMap.nodes.has(edge.fromNodeId)).toBe(true);
      expect(scenarioMap.nodes.has(edge.toNodeId)).toBe(true);
      expect(edge.lengthMeters).toBeGreaterThan(0);
      expect(edge.points).toHaveLength(edge.cumulativeMeters.length);
    }
  });

  it("classifies refuge, site and junction nodes with labels from the scenario", () => {
    const kinds = [...scenarioMap.nodes.values()].map((n) => n.kind);
    expect(kinds.filter((k) => k === "refuge")).toHaveLength(2);
    expect(kinds.filter((k) => k === "site")).toHaveLength(3);
    expect(scenarioMap.nodes.get("n-sa")?.label).toBe("Ridge Cabins");
  });

  it("keeps the briefed ignition patch and terrain for later layers", () => {
    expect(scenarioMap.initialFireCells.length).toBeGreaterThan(0);
    expect(scenarioMap.terrain?.gridSize).toBe(64);
  });
});
