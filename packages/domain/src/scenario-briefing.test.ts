import { describe, expect, it } from "vitest";
import { PublicScenarioBriefing, ScenarioBriefingResponse } from "./scenario-briefing.js";

const valid = {
  version: "synthetic-v1",
  gridSize: 64,
  cellMeters: 25,
  nodes: [
    { id: "n-a", x: 100, y: 800 },
    { id: "n-b", x: 800, y: 100 },
  ],
  edges: [{ id: "e-ab", from: "n-a", to: "n-b", via: [{ x: 400, y: 400 }], singleCapacity: true }],
  sites: [{ id: "site-a", name: "Ridge Cabins", nodeId: "n-b", value: 1.5 }],
  refuges: [{ id: "refuge-west", name: "Refuge West", nodeId: "n-a" }],
  agents: [{ callsign: "Crew 1", role: "protection_crew" }],
  initialFireCells: [1234],
};

describe("domain/PublicScenarioBriefing", () => {
  it("accepts a well-formed public scenario", () => {
    expect(PublicScenarioBriefing.parse(valid)).toEqual(valid);
  });

  it("strips private site effort and any extra keys a server might attach", () => {
    const parsed = PublicScenarioBriefing.parse({
      ...valid,
      worldSeed: "secret",
      sites: [{ ...valid.sites[0], requiredWork: 300 }],
    });
    expect(parsed).not.toHaveProperty("worldSeed");
    expect(parsed.sites[0]).not.toHaveProperty("requiredWork");
  });

  it("defaults optional edge fields", () => {
    const parsed = PublicScenarioBriefing.parse({ ...valid, edges: [{ id: "e", from: "n-a", to: "n-b" }] });
    expect(parsed.edges[0]).toEqual({ id: "e", from: "n-a", to: "n-b", via: [], singleCapacity: false });
  });

  it("rejects references to unknown nodes", () => {
    expect(PublicScenarioBriefing.safeParse({ ...valid, sites: [{ ...valid.sites[0], nodeId: "n-zz" }] }).success).toBe(false);
    expect(PublicScenarioBriefing.safeParse({ ...valid, edges: [{ id: "e", from: "n-a", to: "n-zz" }] }).success).toBe(false);
    expect(PublicScenarioBriefing.safeParse({ ...valid, refuges: [{ id: "r", name: "R", nodeId: "n-zz" }] }).success).toBe(false);
  });

  it("rejects fire cells outside the grid and non-positive site values", () => {
    expect(PublicScenarioBriefing.safeParse({ ...valid, initialFireCells: [64 * 64] }).success).toBe(false);
    expect(PublicScenarioBriefing.safeParse({ ...valid, sites: [{ ...valid.sites[0], value: 0 }] }).success).toBe(false);
  });

  it("wraps the scenario with the protocol version for GET /scenario", () => {
    expect(ScenarioBriefingResponse.safeParse({ protocolVersion: 1, scenario: valid }).success).toBe(true);
    expect(ScenarioBriefingResponse.safeParse({ scenario: valid }).success).toBe(false);
  });
});
