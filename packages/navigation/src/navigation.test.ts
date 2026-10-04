import { describe, expect, it } from "vitest";
import { AgentId, EdgeId, isRoadLeg, NodeId, MissionPlan, MissionPlanId, SequenceNumber, SimTimeMs, SiteId, type AgentPosition } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { Rng, RoadIndex, SIM_DEFAULTS } from "@ember/simulation/model";
import {
  DEFAULT_NAV_CONFIG,
  HazardModel,
  ReturnTable,
  cellOnEdge,
  cellsOfEdge,
  certifyPlan,
  makeEnsemble,
  offRoadTravelMs,
  planMissions,
  planRetreat,
  planReturn,
  protectionTargets,
  timeExpandedSearch,
  workOptions,
  type PlanningContext,
  type ReservationOracle,
  type SiteKnowledge,
} from "./index.js";

const scenario = buildSyntheticScenario();
const map = scenario.map;
const road = new RoadIndex(map);
const agent = AgentId.parse("crew-1");
const atRefuge: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-rw") };

const siteKnowledge = (id: string, done = 0): SiteKnowledge => {
  const s = map.sites.find((x) => x.id === id)!;
  return { siteId: s.id, nodeId: s.nodeId, value: s.value, requiredWork: s.requiredWork, knownCompletedWork: done, knownResolved: false };
};

function ctxWith(over: Partial<PlanningContext> & Pick<PlanningContext, "ensemble">): PlanningContext {
  return { agentId: agent, road, closedCells: new Set(), position: atRefuge, nowMs: 0, ...over };
}

/** Ignite an edge's interior cells (those no other road crosses), so neighbours stay unaffected. */
function ignite(road_: RoadIndex, edges: string[], atMs: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of edges) {
    for (const c of cellsOfEdge(road_, e)) {
      if ((road_.edgesByCell.get(c) ?? []).length === 1) m.set(c, Math.min(atMs, m.get(c) ?? Infinity));
    }
  }
  return m;
}

const siteA = [siteKnowledge("site-a")];

describe("work options", () => {
  it("offers 15 s, then 30 s increments, plus the exact remaining work", () => {
    expect(workOptions(300, 1)).toEqual([15_000, 30_000, 60_000, 90_000, 120_000, 150_000, 180_000, 210_000, 240_000, 270_000, 300_000]);
    expect(workOptions(20, 1)).toEqual([15_000, 20_000]);
    expect(workOptions(0, 1)).toEqual([]);
    expect(workOptions(7, 1)).toEqual([7000 > 15_000 ? 15_000 : 10_000]);
  });
});

describe("complete mission search", () => {
  it("plans one timed approach, work interval and return when nothing threatens the roads", () => {
    const result = planMissions(ctxWith({ ensemble: makeEnsemble(map, [{ id: "a" }]) }), protectionTargets(siteA));
    expect(result.feasible).toBe(true);
    const plan = result.plan!;
    const legs = plan.timedLegs;
    expect(legs[0]?.departMs).toBe(0);
    expect(legs.slice(0, 4).filter(isRoadLeg).map((l) => l.edgeId)).toEqual(["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"]);
    // 75 + 95 + 95 + 85 s: each leg's travel time is rounded up to a 5 s bucket.
    expect(legs[3]?.arriveMs).toBe(350_000);
    expect(plan.workInterval.startMs).toBe(350_000);
    expect(plan.workInterval.endMs - plan.workInterval.startMs).toBe(300_000);
    // Returning to Refuge South (1191 m) beats Refuge West (1342 m).
    expect(legs.length).toBe(7);
    expect(legs.slice(4).filter(isRoadLeg).map((l) => l.edgeId)).toEqual(["e-h-sa", "e-s-h", "e-rs-s"]);
    expect(plan.refugeId).toBe("n-rs");
    for (const l of legs) {
      expect(l.departMs % 5000).toBe(0);
      expect(l.arriveMs % 5000).toBe(0);
    }
    const certified = certifyPlan({
      road,
      ensemble: makeEnsemble(map, [{ id: "a" }]),
      closedCells: new Set(),
      plan,
      position: atRefuge,
      legIndex: 0,
      nowMs: 0,
    });
    expect(certified.ok).toBe(true);
  });

  it("rejects an intentionally infeasible one-member case and names the limiting member", () => {
    // Member b ignites both ways home at 400 s; the earliest possible return crosses after 435 s.
    const ign = ignite(road, ["e-s-h", "e-n-h", "e-h-sc"], 400_000);
    const ensemble = makeEnsemble(map, [{ id: "a" }, { id: "b", ignition: ign }]);
    const result = planMissions(ctxWith({ ensemble }), protectionTargets(siteA));
    expect(result.feasible).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.limitingReason).toBe("no_feasible_mission_in_model");
    expect(result.limitingMemberIds).toEqual(["b"]);
  });

  it("accepts a shorter work interval when the full one fails the same member", () => {
    const ign = ignite(road, ["e-s-h", "e-n-h", "e-h-sc"], 600_000);
    const ensemble = makeEnsemble(map, [{ id: "a" }, { id: "b", ignition: ign }]);
    const result = planMissions(ctxWith({ ensemble }), protectionTargets(siteA));
    expect(result.feasible).toBe(true);
    const work = result.plan!.workInterval.endMs - result.plan!.workInterval.startMs;
    expect(work).toBeGreaterThanOrEqual(15_000);
    expect(work).toBeLessThan(300_000);
    expect(result.plan!.limitingReason).toBe("work_interval_limited_by_forecast");
    // The full-length option is indeed unsafe against member b.
    const full = planMissions(ctxWith({ ensemble }), protectionTargets(siteA).map((t) => ({ ...t, workOptionsMs: [300_000] })));
    expect(full.feasible).toBe(false);
  });

  it("requires the same route and timing to pass every member, not a route per member", () => {
    // Member a blocks the north approach early, member b blocks the south corridor late.
    const ensemble = makeEnsemble(map, [
      { id: "a", ignition: ignite(road, ["e-j1-n"], 20_000) },
      { id: "b", ignition: ignite(road, ["e-s-h"], 700_000) },
    ]);
    const result = planMissions(ctxWith({ ensemble }), protectionTargets(siteA));
    expect(result.feasible).toBe(true);
    const legs = result.plan!.timedLegs.filter(isRoadLeg).map((l) => l.edgeId);
    expect(legs).not.toContain("e-j1-n");
    const hm = new HazardModel(road, ensemble, new Set(), DEFAULT_NAV_CONFIG);
    for (const l of result.plan!.timedLegs.filter(isRoadLeg)) {
      expect(l.departMs).toBeLessThan(hm.latestDepartMs(road.mustEdge(l.edgeId), l.direction));
    }
  });

  it("treats directly observed closed cells as impassable even when every member is clear", () => {
    const closed = new Set(cellsOfEdge(road, "e-rw-j1"));
    const result = planMissions(ctxWith({ ensemble: makeEnsemble(map, [{ id: "a" }]), closedCells: closed }), protectionTargets(siteA));
    expect(result.feasible).toBe(false);
  });

  it("checks every cell crossed, not just junctions", () => {
    const edge = road.mustEdge(EdgeId.parse("e-j1-s"));
    const mid = cellOnEdge(road, "e-j1-s", 0.45);
    const ensemble = makeEnsemble(map, [{ id: "a", ignition: new Map([[mid, 300_000]]) }]);
    const hm = new HazardModel(road, ensemble, new Set(), DEFAULT_NAV_CONFIG);
    let expected = Infinity;
    for (const c of edge.cells) {
      if (c.cell !== mid) continue;
      expected = Math.min(expected, 300_000 - 30_000 - (c.endDist / 4) * 1000);
    }
    expect(hm.latestDepartMs(edge, "forward")).toBeCloseTo(expected, 6);
    expect(hm.latestDepartMs(edge, "forward")).toBeLessThan(300_000 - 30_000);
    // The reverse direction leaves that cell at a different time.
    expect(hm.latestDepartMs(edge, "reverse")).not.toBeCloseTo(expected, 3);
  });

  it("changes the chosen route and arrival when the forecast shifts", () => {
    const before = planMissions(ctxWith({ ensemble: makeEnsemble(map, [{ id: "a" }]) }), protectionTargets(siteA));
    // After the (forecast) wind shift the south corridor closes before a crew could cross it.
    const after = planMissions(
      ctxWith({ ensemble: makeEnsemble(map, [{ id: "a", ignition: ignite(road, ["e-s-h"], 150_000) }]) }),
      protectionTargets(siteA),
    );
    expect(before.plan!.timedLegs.filter(isRoadLeg).map((l) => l.edgeId)).toContain("e-s-h");
    expect(after.feasible).toBe(true);
    expect(after.plan!.timedLegs.filter(isRoadLeg).map((l) => l.edgeId)).not.toContain("e-s-h");
    expect(after.plan!.timedLegs.filter(isRoadLeg).map((l) => l.edgeId)).toContain("e-n-h");
    const arrival = (r: typeof before): number => r.plan!.workInterval.startMs;
    expect(arrival(after)).toBeGreaterThan(arrival(before));
  });

  it("rejects when forecast support ends before the mission can finish", () => {
    const ensemble = makeEnsemble(map, [{ id: "a" }], { horizonMs: 300_000 });
    const result = planMissions(ctxWith({ ensemble }), protectionTargets(siteA));
    expect(result.feasible).toBe(false);
    expect(result.limitingReason).toBe("forecast_horizon_insufficient");
  });

  it("admits nothing from an unreliable or empty ensemble", () => {
    const unreliable = makeEnsemble(map, [{ id: "a" }], { reliability: "unreliable" });
    expect(planMissions(ctxWith({ ensemble: unreliable }), protectionTargets(siteA)).limitingReason).toBe("forecast_unreliable");
    const empty = makeEnsemble(map, []);
    expect(planMissions(ctxWith({ ensemble: empty }), protectionTargets(siteA)).feasible).toBe(false);
  });

  it("waits at a node for a single-capacity window instead of entering a conflicting slot", () => {
    const busyUntil = 400_000;
    const oracle: ReservationOracle = {
      isFree: (edgeId, _dir, enter) => !(edgeId === "e-s-h" && enter < busyUntil),
    };
    const result = planMissions(
      ctxWith({ ensemble: makeEnsemble(map, [{ id: "a" }]), oracle, avoidEdges: new Set([EdgeId.parse("e-n-h")]) }),
      protectionTargets(siteA),
    );
    expect(result.feasible).toBe(true);
    const corridor = result.plan!.timedLegs.find((l) => isRoadLeg(l) && l.edgeId === "e-s-h" && l.direction === "forward")!;
    expect(corridor.departMs).toBeGreaterThanOrEqual(busyUntil);
    // It reached the corridor mouth well before the window opened, so the gap is spent waiting at a node.
    const approachLegs = result.plan!.timedLegs.slice(0, result.plan!.timedLegs.indexOf(corridor));
    expect(approachLegs.filter(isRoadLeg).map((l) => l.edgeId)).toEqual(["e-rw-j1", "e-j1-s"]);
    expect(corridor.departMs - approachLegs[1]!.departMs).toBeGreaterThan(95_000);
  });

  it("uses the alternative approach when the corridor is unavailable", () => {
    const oracle: ReservationOracle = { isFree: (edgeId) => edgeId !== "e-s-h" };
    const result = planMissions(ctxWith({ ensemble: makeEnsemble(map, [{ id: "a" }]), oracle }), protectionTargets(siteA));
    expect(result.feasible).toBe(true);
    expect(result.plan!.timedLegs.filter(isRoadLeg).map((l) => l.edgeId)).toContain("e-n-h");
  });

  it("admits multiple distinct approach routes when both corridors are free", () => {
    const result = planMissions(ctxWith({ ensemble: makeEnsemble(map, [{ id: "a" }]) }), protectionTargets(siteA));
    const routeIds = new Set(result.candidates.map((c) => c.routeId));
    expect(routeIds.size).toBeGreaterThan(1);
    expect([...routeIds].some((id) => id.includes("e-s-h"))).toBe(true);
    expect([...routeIds].some((id) => id.includes("e-n-h"))).toBe(true);
  });

  it("ranks admitted missions by value-weighted benefit per total time, deterministically", () => {
    const targets = protectionTargets([siteKnowledge("site-a"), siteKnowledge("site-b"), siteKnowledge("site-c")]);
    const ensemble = makeEnsemble(map, [{ id: "a" }]);
    const one = planMissions(ctxWith({ ensemble }), targets);
    const two = planMissions(ctxWith({ ensemble }), targets);
    expect(one.candidates.map((c) => c.plan.id)).toEqual(two.candidates.map((c) => c.plan.id));
    const scores = one.candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(one.best).toBe(one.candidates[0]);
    // Fully protecting a site taller in value but longer in work can still outrank a quick one.
    expect(new Set(one.candidates.map((c) => c.target.id)).size).toBe(3);
  });

  it("skips sites it already knows are resolved and subtracts known progress", () => {
    const done = { ...siteKnowledge("site-a", 300), knownResolved: true };
    expect(protectionTargets([done])).toEqual([]);
    const partial = protectionTargets([siteKnowledge("site-a", 200)]);
    expect(partial[0]?.workOptionsMs[partial[0].workOptionsMs.length - 1]).toBe(100_000);
  });

  it("runs the full three-site search well inside the planning budget", () => {
    const targets = protectionTargets(map.sites.map((s) => siteKnowledge(s.id)));
    const ensemble = makeEnsemble(map, Array.from({ length: 24 }, (_, i) => ({ id: `m${i}` })));
    const t0 = Date.now();
    const result = planMissions(ctxWith({ ensemble }), targets);
    const elapsed = Date.now() - t0;
    expect(result.feasible).toBe(true);
    expect(elapsed).toBeLessThan(1500);
    expect(SIM_DEFAULTS.gridSize).toBe(64);
  });
});

describe("certifying committed plans", () => {
  const base = makeEnsemble(map, [{ id: "a" }]);
  const plan = planMissions(ctxWith({ ensemble: base }), protectionTargets(siteA)).plan!;
  const input = { road, closedCells: new Set<number>(), plan, position: atRefuge, legIndex: 0, nowMs: 0 };

  it("fails when new predictions or direct closures break the cached plan", () => {
    const early = makeEnsemble(map, [{ id: "a" }, { id: "b", ignition: ignite(road, ["e-h-sa"], 300_000) }]);
    const result = certifyPlan({ ...input, ensemble: early });
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe("leg");
    const closed = new Set(cellsOfEdge(road, "e-s-h"));
    expect(certifyPlan({ ...input, ensemble: base, closedCells: closed }).ok).toBe(false);
  });

  it("fails the work interval when the site cell ignites before work ends", () => {
    const ens = makeEnsemble(map, [{ id: "b", ignition: new Map([[cellOnEdge(road, "e-h-sa", 1), 500_000]]) }]);
    const result = certifyPlan({ ...input, ensemble: ens });
    expect(result.ok).toBe(false);
  });

  it("treats an agent held at a node past its planned departure as departing now", () => {
    // Nothing is forecast to ignite for a while, but the first road closes to departures after ~140 s.
    const ens = makeEnsemble(map, [{ id: "a", ignition: ignite(road, ["e-rw-j1"], 170_000) }]);
    const onTime = certifyPlan({ ...input, ensemble: ens, nowMs: 0 });
    expect(onTime.ok).toBe(true);
    const held = certifyPlan({ ...input, ensemble: ens, nowMs: 200_000 });
    expect(held.ok).toBe(false);
    expect(held.failure?.kind).toBe("leg");
  });

  it("does not certify from an unreliable ensemble", () => {
    const result = certifyPlan({ ...input, ensemble: makeEnsemble(map, [{ id: "a" }], { reliability: "unreliable" }) });
    expect(result.failure?.kind).toBe("forecast_unreliable");
  });

  it("certifies an off-road leg and a following road return", () => {
    const ensemble = makeEnsemble(map, [{ id: "a" }]);
    const dist = 360.555;
    const travelMs = offRoadTravelMs(dist, DEFAULT_NAV_CONFIG);
    const offPlan = MissionPlan.parse({
      id: MissionPlanId.parse("off-cert"),
      recipientId: agent,
      knowledgeRevision: SequenceNumber.parse(0),
      timedLegs: [
        {
          kind: "off_road",
          fromX: 700,
          fromY: 600,
          toX: 1000,
          toY: 800,
          endNodeId: NodeId.parse("n-h"),
          departMs: SimTimeMs.parse(0),
          arriveMs: SimTimeMs.parse(travelMs),
        },
      ],
      workInterval: { startMs: SimTimeMs.parse(travelMs), endMs: SimTimeMs.parse(travelMs) },
      refugeId: NodeId.parse("n-rs"),
      reservationRevision: 0,
      limitingReason: null,
    });
    const atSouth: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-s") };
    const ok = certifyPlan({
      road,
      ensemble,
      closedCells: new Set(),
      plan: offPlan,
      position: atSouth,
      legIndex: 0,
      nowMs: 0,
    });
    expect(ok.ok).toBe(true);
    const ret = planReturn(ctxWith({ ensemble, position: { kind: "node", nodeId: NodeId.parse("n-h") }, nowMs: travelMs }));
    expect(ret).not.toBeNull();
    expect(ret!.plan.timedLegs.filter(isRoadLeg).length).toBeGreaterThan(0);
  });
});

describe("withdrawal, reversal and retreat", () => {
  const midCorridor: AgentPosition = {
    kind: "edge",
    edgeId: EdgeId.parse("e-s-h"),
    distanceAlongPolyline: 100 as never,
    direction: "forward",
    turnaroundTimeRemaining: 0 as never,
  };

  it("reverses mid-edge, paying the turnaround, when the way ahead is no longer safe", () => {
    const ahead = cellOnEdge(road, "e-s-h", 0.8);
    const ensemble = makeEnsemble(map, [{ id: "a", ignition: new Map([[ahead, 100_000]]) }], { nowMs: 60_000 });
    const ret = planReturn(ctxWith({ ensemble, position: midCorridor, nowMs: 60_000 }));
    expect(ret).not.toBeNull();
    const first = ret!.plan.timedLegs[0]!;
    expect(isRoadLeg(first)).toBe(true);
    if (!isRoadLeg(first)) throw new Error("expected road leg");
    expect(first.edgeId).toBe("e-s-h");
    expect(first.direction).toBe("reverse");
    expect(first.departMs).toBe(60_000);
    // 5 s turnaround + 100 m / 4 m/s = 30 s.
    expect(first.arriveMs).toBe(90_000);
    expect(ret!.bestEffort).toBe(false);
  });

  it("continues forward when that is the safer way out", () => {
    const behind = cellOnEdge(road, "e-s-h", 0.1);
    const ensemble = makeEnsemble(map, [{ id: "a", ignition: new Map([[behind, 80_000]]) }], { nowMs: 60_000 });
    const ret = planReturn(ctxWith({ ensemble, position: midCorridor, nowMs: 60_000 }));
    const leg0 = ret!.plan.timedLegs[0]!;
    expect(isRoadLeg(leg0)).toBe(true);
    if (isRoadLeg(leg0)) expect(leg0.direction).toBe("forward");
  });

  it("falls back to a best-effort retreat that minimizes exposure when no normal return passes", () => {
    const atHub: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-h") };
    // Both ways home burn soon, but the north way burns later: lower exposure despite being longer.
    const south = ignite(road, ["e-s-h", "e-j1-s", "e-rs-s", "e-h-sc", "e-rs-sc"], 20_000);
    const north = ignite(road, ["e-n-h", "e-j1-n"], 200_000);
    const merged = new Map([...south, ...north]);
    const ensemble = makeEnsemble(map, [{ id: "a", ignition: merged }]);
    const ctx = ctxWith({ ensemble, position: atHub, nowMs: 10_000 });
    expect(planReturn(ctx)).toBeNull();
    const retreat = planRetreat(ctx);
    expect(retreat).not.toBeNull();
    expect(retreat!.bestEffort).toBe(true);
    expect(retreat!.plan.limitingReason).toBe("best_effort_retreat");
    const r0 = retreat!.plan.timedLegs[0];
    expect(isRoadLeg(r0!)).toBe(true);
    if (isRoadLeg(r0!)) expect(r0.edgeId).toBe("e-n-h");
  });

  it("never retreats through directly observed burning cells and reports stranded when none is passable", () => {
    const atHub: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-h") };
    const closed = new Set([...cellsOfEdge(road, "e-s-h"), ...cellsOfEdge(road, "e-n-h"), ...cellsOfEdge(road, "e-h-sc")]);
    const ensemble = makeEnsemble(map, [{ id: "a" }]);
    expect(planRetreat(ctxWith({ ensemble, position: atHub, closedCells: closed }))).toBeNull();
  });

  it("ranks emergency options with provisional candidates when the forecast is unreliable", () => {
    const atHub: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-h") };
    const ensemble = makeEnsemble(map, [{ id: "p", ignition: ignite(road, ["e-s-h", "e-h-sc"], 20_000) }], { reliability: "unreliable" });
    const retreat = planRetreat(ctxWith({ ensemble, position: atHub, nowMs: 10_000 }));
    const r0 = retreat?.plan.timedLegs[0];
    expect(isRoadLeg(r0!)).toBe(true);
    if (isRoadLeg(r0!)) expect(r0.edgeId).toBe("e-n-h");
    expect(retreat?.bestEffort).toBe(true);
    expect(SiteId.parse("x")).toBe("x");
  });
});

describe("backward return table agrees with the forward search", () => {
  it("gives the same earliest refuge arrival from many random starts and random forecasts", () => {
      const rng = new Rng(4242);
    const edges = map.edges.map((e) => e.id as string);
    const nodes = map.nodes.map((n) => n.id);
    let compared = 0;
    for (let trial = 0; trial < 12; trial++) {
      const ignition = new Map<number, number>();
      for (let j = 0; j < rng.int(0, 4); j++) {
        const e = edges[rng.int(0, edges.length - 1)]!;
        for (const [c, t] of ignite(road, [e], rng.int(100, 900) * 1000)) ignition.set(c, t);
      }
      const ensemble = makeEnsemble(map, [{ id: "r", ignition }]);
      const hm = new HazardModel(road, ensemble, new Set(), DEFAULT_NAV_CONFIG);
      const table = new ReturnTable(hm, 0, { isFree: () => true }, undefined, DEFAULT_NAV_CONFIG);
      const refuges = new Set(road.map.refuges.map((r) => r.nodeId));
      for (let s = 0; s < 6; s++) {
        const node = nodes[rng.int(0, nodes.length - 1)]!;
        const k = rng.int(0, 120);
        const reach = timeExpandedSearch({ hm, nowMs: 0, starts: [{ nodeId: node, k, prefix: [] }], oracle: { isFree: () => true }, config: DEFAULT_NAV_CONFIG });
        const forward = reach.earliest(refuges);
        const backward = table.arrival(node, k);
        expect(backward).toBe(forward === null ? -1 : forward.k);
        if (backward >= 0) {
          // The reconstructed legs are chronological and end at a refuge by the stated arrival.
          const ret = table.returnFrom(node, k);
          let last = k * 5000;
          for (const l of ret.legs) {
            expect(l.departMs).toBeGreaterThanOrEqual(last);
            last = l.arriveMs;
          }
          if (ret.legs.length > 0) expect(last).toBe(backward * 5000);
          expect(refuges.has(ret.refuge)).toBe(true);
        }
        compared += 1;
      }
    }
    expect(compared).toBe(72);
  });
});
