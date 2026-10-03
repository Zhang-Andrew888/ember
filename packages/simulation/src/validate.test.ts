import { describe, expect, it } from "vitest";
import { NodeId } from "@ember/domain";
import { cellIndexOf } from "./model/index.js";
import { Incident, buildSyntheticScenario, scenarioGates, validateScenario, type SimScenario } from "./index.js";

describe("scenario validation", () => {
  it("accepts the synthetic scenario", () => {
    expect(validateScenario(buildSyntheticScenario())).toEqual([]);
  });

  it("reports dangling references, duplicates and disconnected nodes", () => {
    const s = buildSyntheticScenario();
    const bad: SimScenario = {
      ...s,
      agents: [{ ...s.agents[0]!, startNodeId: NodeId.parse("ghost") }, s.agents[1]!],
      map: {
        ...s.map,
        nodes: [...s.map.nodes, { id: NodeId.parse("island"), x: 1500, y: 1500 }, s.map.nodes[0]!],
        sites: [{ ...s.map.sites[0]!, nodeId: NodeId.parse("nowhere") }],
      },
    };
    const errors = validateScenario(bad);
    expect(errors.some((e) => /unknown node ghost/.test(e))).toBe(true);
    expect(errors.some((e) => /duplicate node/.test(e))).toBe(true);
    expect(errors.some((e) => /nowhere/.test(e))).toBe(true);
  });

  it("reports ignition inside a refuge area and an unreachable node", () => {
    const s = buildSyntheticScenario();
    const nearRefuge = { ...s, map: { ...s.map, initialFireCells: [cellIndexOf(100, 800)!] } };
    expect(validateScenario(nearRefuge).some((e) => /inside a refuge area/.test(e))).toBe(true);
    const island = { ...s, map: { ...s.map, nodes: [...s.map.nodes, { id: NodeId.parse("island"), x: 1500, y: 1500 }] } };
    expect(validateScenario(island).some((e) => /island is not connected/.test(e))).toBe(true);
  });
});

describe("incident creation", () => {
  it("refuses to start from an invalid scenario", () => {
    const s = buildSyntheticScenario();
    const bad = { ...s, agents: [{ ...s.agents[0]!, startNodeId: NodeId.parse("ghost") }] };
    expect(() => new Incident({ scenario: bad, seed: "x" })).toThrow(/invalid scenario.*ghost/);
  });
});

describe("scenario geometry gates", () => {
  it("passes every acceptance gate for the synthetic scenario", () => {
    const gates = scenarioGates(buildSyntheticScenario());
    expect(gates.map((g) => g.gate)).toEqual(["ignition clearance", "travel time", "alternative approach", "constrained segment", "scouting points"]);
    for (const g of gates) expect(g.ok, `${g.gate}: ${g.detail}`).toBe(true);
  });

  it("fails the gates a bad crop would fail", () => {
    const s = buildSyntheticScenario();
    const closeFire = scenarioGates({ ...s, map: { ...s.map, initialFireCells: [cellIndexOf(180, 850)!] } });
    expect(closeFire.find((g) => g.gate === "ignition clearance")?.ok).toBe(false);
    // Remove the alternative routes: only the corridor road remains to the sites.
    const keep = new Set(["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa", "e-h-sb", "e-h-sc"]);
    const single = { ...s, map: { ...s.map, edges: s.map.edges.filter((e) => keep.has(e.id)), refuges: [s.map.refuges[0]!], nodes: s.map.nodes.filter((n) => n.id !== "n-rs" && n.id !== "n-n"), scoutPoints: [NodeId.parse("n-s")] } };
    const gates = scenarioGates({ ...single, agents: [s.agents[0]!] });
    expect(gates.find((g) => g.gate === "alternative approach")?.ok).toBe(false);
    expect(gates.find((g) => g.gate === "scouting points")?.ok).toBe(false);
  });
});
