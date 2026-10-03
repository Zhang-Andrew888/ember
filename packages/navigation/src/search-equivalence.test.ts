import { describe, expect, it } from "vitest";
import { Meters, SimTimeMs, type EdgeId, type NodeId, type TimedLeg } from "@ember/domain";
import { buildSyntheticScenario, osmMontclairScenario, type SimScenario } from "@ember/simulation";
import { Rng, RoadIndex } from "@ember/simulation/model";
import {
  ALWAYS_FREE,
  DEFAULT_NAV_CONFIG,
  HazardModel,
  bucketTravelMs,
  cellsOfEdge,
  makeEnsemble,
  planMissions,
  planReturn,
  protectionTargets,
  startsFromPosition,
  timeExpandedSearch,
  type PlanningContext,
  type SearchStart,
} from "./index.js";

/**
 * The search is the planner's hot path and is optimized (typed arrays, a per-road static graph,
 * early stop, a connectivity shortcut). These tests pin it to a plain Map-based reference of the
 * documented algorithm so the optimizations cannot change what the planner decides.
 */

type RefParent =
  | { kind: "start"; start: SearchStart }
  | { kind: "wait"; fromK: number }
  | { kind: "leg"; fromK: number; from: NodeId; edge: EdgeId; direction: "forward" | "reverse" };

/** The straightforward layered search: Maps of parents, sorted node and option order. */
function referenceSearch(hm: HazardModel, nowMs: number, starts: readonly SearchStart[], ban: ReadonlySet<EdgeId> | undefined) {
  const config = DEFAULT_NAV_CONFIG;
  const { road } = hm;
  const maxK = Math.floor((hm.horizonEndMs - config.bufferMs - 1 - nowMs) / config.bucketMs);
  const layers: Map<NodeId, RefParent>[] = [];
  for (let k = 0; k <= Math.max(0, maxK); k++) layers.push(new Map());
  for (const s of starts) {
    if (s.k > maxK) continue;
    if (!layers[s.k]!.has(s.nodeId)) layers[s.k]!.set(s.nodeId, { kind: "start", start: s });
  }
  for (let k = 0; k <= maxK; k++) {
    const t = nowMs + k * config.bucketMs;
    for (const node of [...layers[k]!.keys()].sort()) {
      if (k + 1 <= maxK) {
        const existing = layers[k + 1]!.get(node);
        if (existing === undefined || existing.kind === "leg") {
          if (road.refugeNodes.has(node) || hm.nodeSafeAt(node, t + config.bucketMs)) layers[k + 1]!.set(node, { kind: "wait", fromK: k });
        }
      }
      const options = [...(road.adjacency.get(node) ?? [])].sort((a, b) =>
        a.edgeId !== b.edgeId ? (a.edgeId < b.edgeId ? -1 : 1) : a.direction < b.direction ? -1 : 1,
      );
      for (const adj of options) {
        if (ban?.has(adj.edgeId)) continue;
        const edge = road.mustEdge(adj.edgeId);
        if (!(t < hm.latestDepartMs(edge, adj.direction))) continue;
        const arriveK = k + bucketTravelMs(edge.length, config) / config.bucketMs;
        if (arriveK > maxK || layers[arriveK]!.has(adj.toNode)) continue;
        layers[arriveK]!.set(adj.toNode, { kind: "leg", fromK: k, from: node, edge: edge.id, direction: adj.direction });
      }
    }
  }
  const legsTo = (nodeId: NodeId, k: number): TimedLeg[] => {
    const out: TimedLeg[] = [];
    let node = nodeId;
    let layer = k;
    for (;;) {
      const parent = layers[layer]!.get(node)!;
      if (parent.kind === "start") return [...parent.start.prefix, ...out.reverse()];
      if (parent.kind === "wait") {
        layer = parent.fromK;
        continue;
      }
      out.push({
        edgeId: parent.edge,
        direction: parent.direction,
        departMs: SimTimeMs.parse(nowMs + parent.fromK * config.bucketMs),
        arriveMs: SimTimeMs.parse(nowMs + layer * config.bucketMs),
      });
      node = parent.from;
      layer = parent.fromK;
    }
  };
  const earliest = (targets: ReadonlySet<NodeId>) => {
    for (let k = 0; k < layers.length; k++) {
      const hits = [...layers[k]!.keys()].filter((n) => targets.has(n)).sort();
      if (hits.length > 0) return { nodeId: hits[0]!, k };
    }
    return null;
  };
  return { earliest, legsTo, layers };
}

function randomFire(road: RoadIndex, rng: Rng): Map<number, number> {
  const ignition = new Map<number, number>();
  const edges = [...road.edges.keys()];
  const count = rng.int(0, 12);
  for (let j = 0; j < count; j++) {
    const e = edges[rng.int(0, edges.length - 1)]!;
    const at = rng.int(60, 1500) * 1000;
    for (const c of cellsOfEdge(road, e)) ignition.set(c, Math.min(at, ignition.get(c) ?? Infinity));
  }
  return ignition;
}

function checkScenario(scenario: SimScenario, seed: number, trials: number): { compared: number; reachable: number } {
  const road = new RoadIndex(scenario.map);
  const rng = new Rng(seed);
  const nodes = scenario.map.nodes.map((n) => n.id as NodeId);
  const edges = [...road.edges.keys()];
  let compared = 0;
  let reachable = 0;
  for (let trial = 0; trial < trials; trial++) {
    const ensemble = makeEnsemble(scenario.map, [{ id: "a", ignition: randomFire(road, rng) }, { id: "b", ignition: randomFire(road, rng) }]);
    const hm = new HazardModel(road, ensemble, new Set(), DEFAULT_NAV_CONFIG);
    const start = nodes[rng.int(0, nodes.length - 1)]!;
    const nowMs = rng.int(0, 10) * 5000;
    const starts: SearchStart[] = [{ nodeId: start, k: 0, prefix: [] }];
    const ban = new Set<EdgeId>();
    for (let b = 0; b < rng.int(0, 4); b++) ban.add(edges[rng.int(0, edges.length - 1)]!);
    const reference = referenceSearch(hm, nowMs, starts, ban);
    const full = timeExpandedSearch({ hm, nowMs, starts, oracle: ALWAYS_FREE, ban, config: DEFAULT_NAV_CONFIG });
    for (let g = 0; g < 4; g++) {
      const goal = new Set<NodeId>([nodes[rng.int(0, nodes.length - 1)]!, nodes[rng.int(0, nodes.length - 1)]!]);
      const expected = reference.earliest(goal);
      expect(full.earliest(goal)).toEqual(expected);
      const stopped = timeExpandedSearch({ hm, nowMs, starts, oracle: ALWAYS_FREE, ban, config: DEFAULT_NAV_CONFIG, stopAt: goal });
      expect(stopped.earliest(goal)).toEqual(expected);
      if (expected !== null) {
        reachable += 1;
        expect(full.legsTo(expected.nodeId, expected.k)).toEqual(reference.legsTo(expected.nodeId, expected.k));
        expect(stopped.legsTo(expected.nodeId, expected.k)).toEqual(reference.legsTo(expected.nodeId, expected.k));
      }
      compared += 1;
    }
    // Every reached (node, bucket) agrees, not just the goals above.
    for (const n of nodes.slice(0, 12)) {
      const k = reference.layers.findIndex((l) => l.has(n));
      expect(full.reachedAt(n)).toBe(k < 0 ? null : k);
    }
  }
  return { compared, reachable };
}

describe("optimized search matches the reference algorithm", () => {
  it("on the synthetic graph, with early stop and edge bans", () => {
    const r = checkScenario(buildSyntheticScenario(), 11, 25);
    expect(r.compared).toBe(100);
    expect(r.reachable).toBeGreaterThan(40);
  });

  it("on the OSM Montclair graph, with early stop and edge bans", () => {
    const r = checkScenario(osmMontclairScenario(), 12, 15);
    expect(r.compared).toBe(60);
    expect(r.reachable).toBeGreaterThan(20);
  });

  it("starting mid-edge (finish or reverse) agrees with the reference", () => {
    const scenario = osmMontclairScenario();
    const road = new RoadIndex(scenario.map);
    const rng = new Rng(21);
    const edgeIds = [...road.edges.keys()];
    for (let i = 0; i < 12; i++) {
      const edge = road.mustEdge(edgeIds[rng.int(0, edgeIds.length - 1)]!);
      const ensemble = makeEnsemble(scenario.map, [{ id: "a", ignition: randomFire(road, rng) }]);
      const hm = new HazardModel(road, ensemble, new Set(), DEFAULT_NAV_CONFIG);
      const starts = startsFromPosition(
        hm,
        { kind: "edge", edgeId: edge.id, direction: "forward", distanceAlongPolyline: Meters.parse(edge.length * 0.4), turnaroundTimeRemaining: SimTimeMs.parse(0) },
        0,
        DEFAULT_NAV_CONFIG,
      );
      const refuges = new Set<NodeId>(scenario.map.refuges.map((r) => r.nodeId));
      const reference = referenceSearch(hm, 0, starts, undefined);
      const hit = reference.earliest(refuges);
      const got = timeExpandedSearch({ hm, nowMs: 0, starts, oracle: ALWAYS_FREE, config: DEFAULT_NAV_CONFIG, stopAt: refuges });
      expect(got.earliest(refuges)).toEqual(hit);
      if (hit !== null) expect(got.legsTo(hit.nodeId, hit.k)).toEqual(reference.legsTo(hit.nodeId, hit.k));
    }
  });

  it("reports an edge-banned, cut-off goal as unreachable and still allows an empty reach to be queried", () => {
    const scenario = osmMontclairScenario();
    const road = new RoadIndex(scenario.map);
    const site = scenario.map.sites[0]!;
    const ban = new Set<EdgeId>((road.adjacency.get(site.nodeId) ?? []).map((a) => a.edgeId));
    const hm = new HazardModel(road, makeEnsemble(scenario.map, [{ id: "a" }]), new Set(), DEFAULT_NAV_CONFIG);
    const from = scenario.map.refuges[0]!.nodeId;
    const goal = new Set<NodeId>([site.nodeId]);
    const reach = timeExpandedSearch({ hm, nowMs: 0, starts: [{ nodeId: from, k: 0, prefix: [] }], oracle: ALWAYS_FREE, ban, config: DEFAULT_NAV_CONFIG, stopAt: goal });
    expect(reach.earliest(goal)).toBeNull();
    expect(reach.reachedAt(site.nodeId)).toBeNull();
    expect(() => reach.legsTo(site.nodeId, 3)).toThrow("path not reachable");
  });
});

describe("planners that build on the search stay deterministic", () => {
  it("plans every OSM site and the return identically on repeated calls", () => {
    const scenario = osmMontclairScenario();
    const road = new RoadIndex(scenario.map);
    const ensemble = makeEnsemble(scenario.map, [{ id: "a", ignition: randomFire(road, new Rng(5)) }]);
    const refuge = scenario.map.refuges[0]!.nodeId;
    const targets = protectionTargets(
      scenario.map.sites.map((s) => ({ siteId: s.id, nodeId: s.nodeId, value: s.value, requiredWork: s.requiredWork, knownCompletedWork: 0, knownResolved: false })),
    );
    const ctx: PlanningContext = {
      agentId: scenario.agents[0]!.id as PlanningContext["agentId"],
      road,
      ensemble,
      closedCells: new Set(),
      position: { kind: "node", nodeId: refuge },
      nowMs: 0,
      diagnose: false,
    };
    const first = planMissions(ctx, targets);
    const second = planMissions(ctx, targets);
    expect(first.candidates.map((c) => c.plan.id)).toEqual(second.candidates.map((c) => c.plan.id));
    expect(planReturn(ctx)?.plan.id).toBe(planReturn(ctx)?.plan.id);
  });
});
