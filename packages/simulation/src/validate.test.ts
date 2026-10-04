import { describe, expect, it } from "vitest";
import { NodeId } from "@ember/domain";
import { SIM_DEFAULTS, cellIndexOf, cellsWithin } from "./model/index.js";
import { Incident, SimScenario, buildSyntheticScenario, scenarioGates, validateScenario } from "./index.js";

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

  it("rejects a site shifted to x=1650 m even though every geometry gate still passes", () => {
    const s = buildSyntheticScenario();
    const shifted: SimScenario = {
      ...s,
      map: {
        ...s.map,
        nodes: s.map.nodes.map((n) => ({ ...n, x: n.x + 400 })),
        edges: s.map.edges.map((e) => ({ ...e, via: e.via.map((p) => ({ x: p.x + 400, y: p.y })) })),
      },
    };
    const siteB = shifted.map.sites.find((site) => site.id === "site-b");
    const siteNode = shifted.map.nodes.find((n) => n.id === siteB?.nodeId);
    expect(siteNode).toMatchObject({ id: "n-sb", x: 1650, y: 800 });
    expect(cellsWithin(1650, 800, SIM_DEFAULTS.siteExposureRadiusM)).toEqual([]);
    const gates = scenarioGates(shifted);
    expect(gates).toHaveLength(4);
    for (const g of gates) expect(g.ok, `${g.gate}: ${g.detail}`).toBe(true);
    expect(validateScenario(shifted).filter((e) => /off the grid/.test(e)).sort()).toEqual([
      "node n-sa is off the grid",
      "node n-sb is off the grid",
      "node n-sc is off the grid",
    ]);
    expect(() => new Incident({ scenario: shifted, seed: "x" })).toThrow(/off the grid/);
  });

  it("rejects non-finite coordinates, off-grid via points, and zero-length edges", () => {
    const s = buildSyntheticScenario();
    const nonFinite: SimScenario = {
      ...s,
      map: { ...s.map, nodes: s.map.nodes.map((n) => (n.id === "n-rw" ? { ...n, y: Number.NaN } : n)) },
    };
    expect(validateScenario(nonFinite).some((e) => e === "node n-rw has non-finite coordinates")).toBe(true);

    const via: SimScenario = {
      ...s,
      map: {
        ...s.map,
        edges: s.map.edges.map((e) => (e.id === "e-rs-sc" ? { ...e, via: [{ x: -10, y: 250 }] } : e)),
      },
    };
    expect(validateScenario(via)).toContain("edge e-rs-sc via point 0 is off the grid");

    const zero: SimScenario = {
      ...s,
      map: {
        ...s.map,
        edges: s.map.edges.map((e) => (e.id === "e-rw-j1" ? { ...e, to: e.from, via: [] } : e)),
      },
    };
    expect(validateScenario(zero)).toContain("edge e-rw-j1 has invalid geometry");
  });

  it("schema rejects an off-grid node", () => {
    const s = buildSyntheticScenario();
    const raw = {
      ...s,
      map: { ...s.map, nodes: s.map.nodes.map((n) => (n.id === "n-sb" ? { ...n, x: 1650 } : n)) },
    };
    const parsed = SimScenario.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.message === "is off the grid")).toBe(true);
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
    expect(gates.map((g) => g.gate)).toEqual(["ignition clearance", "travel time", "alternative approach", "constrained segment"]);
    for (const g of gates) expect(g.ok, `${g.gate}: ${g.detail}`).toBe(true);
  });

  it("fails the gates a bad crop would fail", () => {
    const s = buildSyntheticScenario();
    const closeFire = scenarioGates({ ...s, map: { ...s.map, initialFireCells: [cellIndexOf(180, 850)!] } });
    expect(closeFire.find((g) => g.gate === "ignition clearance")?.ok).toBe(false);
    // Remove the alternative routes: only the corridor road remains to the sites.
    const keep = new Set(["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa", "e-h-sb", "e-h-sc"]);
    const single = { ...s, map: { ...s.map, edges: s.map.edges.filter((e) => keep.has(e.id)), refuges: [s.map.refuges[0]!], nodes: s.map.nodes.filter((n) => n.id !== "n-rs" && n.id !== "n-n") } };
    const gates = scenarioGates({ ...single, agents: [s.agents[0]!] });
    expect(gates.find((g) => g.gate === "alternative approach")?.ok).toBe(false);
  });
});
