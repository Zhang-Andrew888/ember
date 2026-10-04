import { describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, SiteId } from "@ember/domain";
import {
  Incident,
  SIM_DEFAULTS,
  authoredCommit,
  buildSyntheticScenario,
  osmMontclairScenario,
  recordOf,
  replayRecord,
  scenarioGates,
  scenarioHash,
  validateScenario,
  type SimScenario,
} from "./index.js";
import { RoadIndex } from "./model/index.js";

vi.setConfig({ testTimeout: 120_000 });

// Host clock for measurement only; this package's tsconfig has no DOM/Node lib.
declare const performance: { now(): number };

const FROZEN_HASH = "9a3258eb5336fb24444cd23ef4adb17a";

/** Edge ids of the shortest road route between two nodes. */
function route(road: RoadIndex, from: string, to: string): string[] {
  const dist = new Map<string, number>([[from, 0]]);
  const via = new Map<string, { edge: string; prev: string }>();
  const open = [from];
  while (open.length > 0) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const n = open.shift()!;
    for (const adj of road.adjacency.get(NodeId.parse(n)) ?? []) {
      const d = dist.get(n)! + road.mustEdge(adj.edgeId).length;
      if (d < (dist.get(adj.toNode) ?? Infinity)) {
        dist.set(adj.toNode, d);
        via.set(adj.toNode, { edge: adj.edgeId, prev: n });
        open.push(adj.toNode);
      }
    }
  }
  const out: string[] = [];
  for (let at = to; at !== from; ) {
    const step = via.get(at);
    if (step === undefined) throw new Error(`no route from ${from} to ${to}`);
    out.unshift(step.edge);
    at = step.prev;
  }
  return out;
}

function play(scenario: SimScenario, seed: string): { inc: Incident; stepMs: number[] } {
  const inc = new Incident({ scenario, seed });
  const road = new RoadIndex(scenario.map);
  const site = scenario.map.sites[0]!;
  const crew = scenario.agents.find((a) => a.role === "protection_crew")!;
  const there = route(road, crew.startNodeId, site.nodeId);
  const back = route(road, site.nodeId, crew.startNodeId);
  inc.submit(
    authoredCommit({
      road,
      agentId: AgentId.parse(crew.id),
      planId: "osm-plan",
      knowledgeRevision: inc.agentRevision(AgentId.parse(crew.id)),
      startNode: crew.startNodeId,
      departMs: 0,
      approach: there,
      workSiteId: SiteId.parse(site.id),
      workMs: 120_000,
      back,
    }),
  );
  const stepMs: number[] = [];
  while (!inc.ended && inc.simTimeMs < SIM_DEFAULTS.incidentHorizonMs) {
    const t0 = performance.now();
    inc.advanceTo(inc.simTimeMs + SIM_DEFAULTS.stepMs);
    stepMs.push(performance.now() - t0);
  }
  return { inc, stepMs };
}

describe("OSM Montclair scenario", () => {
  const scenario = osmMontclairScenario();

  it("is frozen: version, hash and size are pinned", () => {
    expect(scenario.version).toBe("osm-montclair-v1");
    expect(scenarioHash(scenario)).toBe(FROZEN_HASH);
    expect(scenario.map.nodes).toHaveLength(113);
    expect(scenario.map.edges).toHaveLength(137);
  });

  it("is structurally valid and passes every documented geometry gate", () => {
    expect(validateScenario(scenario)).toEqual([]);
    const gates = scenarioGates(scenario);
    for (const g of gates) expect(g.ok, `${g.gate}: ${g.detail}`).toBe(true);
    expect(gates).toHaveLength(4);
  });

  it("keeps real OSM identifiers and stays inside the 1.6 km grid", () => {
    const limit = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.cellMeters;
    for (const n of scenario.map.nodes) {
      expect(n.id).toMatch(/^n-\d+$/);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(limit);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(limit);
    }
    for (const e of scenario.map.edges) {
      expect(e.id).toMatch(/^e-\d+-\d+/);
      for (const p of e.via) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(limit);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(limit);
      }
    }
    expect(new Set(scenario.map.nodes.map((n) => n.id)).size).toBe(scenario.map.nodes.length);
    expect(scenario.briefing).toContain("OpenStreetMap");
  });

  it("matches the documented authored layer: two refuges, three named sites, one constrained segment, crews only", () => {
    expect(scenario.map.refuges.map((r) => r.name)).toEqual(["Refuge West", "Refuge South"]);
    expect(scenario.map.sites.map((s) => [s.name, s.requiredWork, s.value])).toEqual([
      ["Ridge Cabins", 300, 1],
      ["Waterworks", 450, 1.5],
      ["Community Lodge", 600, 2],
    ]);
    expect(scenario.map.edges.filter((e) => e.singleCapacity)).toHaveLength(1);
    expect(scenario.agents.map((a) => a.callsign)).toEqual(["Crew 1", "Crew 2", "Crew 3"]);
    expect(scenario.map.initialFireCells).toHaveLength(4);
  });

  it("runs a full incident: the crew's mission is accepted, the fire closes roads, and the run replays exactly", () => {
    const { inc } = play(scenario, "osm-1");
    expect(inc.notices.some((n) => n.kind === "plan_accepted")).toBe(true);
    expect(inc.notices.some((n) => n.kind === "plan_rejected")).toBe(false);
    expect(inc.notices.some((n) => n.kind === "edge_closed")).toBe(true);
    const replayed = replayRecord(recordOf(inc));
    expect(replayed.hashMatches).toBe(true);
    expect(replayed.firstDivergenceMs).toBeNull();
  });

  it("is reproducible per seed and differs across seeds", () => {
    const a = play(scenario, "osm-repro").inc.snapshotHash();
    expect(play(scenario, "osm-repro").inc.snapshotHash()).toBe(a);
    expect(play(scenario, "osm-other").inc.snapshotHash()).not.toBe(a);
  });

  it("keeps the authoritative step well inside the budget on the real road graph", () => {
    const { stepMs } = play(scenario, "osm-budget");
    const sorted = [...stepMs].sort((x, y) => x - y);
    expect(sorted.length).toBeGreaterThan(300);
    expect(sorted[Math.floor(sorted.length * 0.95)]!).toBeLessThan(20);
    expect(sorted[sorted.length - 1]!).toBeLessThan(200);
  });

  it("leaves the synthetic scenario as the unchanged default", () => {
    expect(buildSyntheticScenario().version).toBe("synthetic-v1");
    expect(scenarioHash(buildSyntheticScenario())).not.toBe(FROZEN_HASH);
  });
});
