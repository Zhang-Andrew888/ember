import { describe, expect, it } from "vitest";
import { AgentId, MissionPlan, MissionPlanId, NodeId, SimTimeMs, SiteId, type EdgeId } from "@ember/domain";
import { Incident, buildSyntheticScenario, legTravelMs, recordOf, replayRecord } from "./index.js";
import { Rng, RoadIndex, SIM_DEFAULTS } from "./model/index.js";

/**
 * Random but structurally plausible orders thrown at the simulator: whatever the agents are told,
 * the physical invariants of the world must hold and the run must replay exactly.
 */
function randomPlan(rng: Rng, road: RoadIndex, inc: Incident, agentId: string) {
  const proj = inc.projectAgent(AgentId.parse(agentId));
  const now = inc.simTimeMs;
  const legs: MissionPlan["timedLegs"] = [];
  let t = now + rng.int(0, 10) * 1000;
  let at: NodeId | null = proj.position.kind === "node" ? proj.position.nodeId : null;
  let startEdge: EdgeId | null = null;
  let heading: "forward" | "reverse" = "forward";
  if (proj.position.kind === "edge") {
    startEdge = proj.position.edgeId;
    heading = rng.next() < 0.5 ? proj.position.direction : proj.position.direction === "forward" ? "reverse" : "forward";
    const e = road.mustEdge(startEdge);
    legs.push({ kind: "road", edgeId: startEdge, direction: heading, departMs: SimTimeMs.parse(now), arriveMs: SimTimeMs.parse(now + legTravelMs(e.length)) });
    at = heading === "forward" ? e.to : e.from;
    t = now + legTravelMs(e.length);
  }
  const steps = rng.int(0, 5);
  for (let i = 0; i < steps && at !== null; i++) {
    const options = road.adjacency.get(at) ?? [];
    if (options.length === 0) break;
    const adj = options[rng.int(0, options.length - 1)]!;
    const e = road.mustEdge(adj.edgeId);
    legs.push({ kind: "road", edgeId: adj.edgeId, direction: adj.direction, departMs: SimTimeMs.parse(t), arriveMs: SimTimeMs.parse(t + legTravelMs(e.length)) });
    t += legTravelMs(e.length) + rng.int(0, 3) * 5000;
    at = adj.toNode;
  }
  const work = rng.next() < 0.5 ? rng.int(1, 8) * 15_000 : 0;
  const approachEnd = legs.length === 0 ? now : legs[legs.length - 1]!.arriveMs;
  return {
    plan: MissionPlan.parse({
      id: MissionPlanId.parse(`fuzz-${agentId}-${now}`),
      recipientId: AgentId.parse(agentId),
      knowledgeRevision: inc.agentRevision(AgentId.parse(agentId)),
      timedLegs: legs,
      workInterval: { startMs: approachEnd, endMs: approachEnd + work },
      refugeId: NodeId.parse("n-rw"),
      reservationRevision: 0,
      limitingReason: null,
    }),
    siteAtEnd: at === null ? null : (road.map.sites.find((s) => s.nodeId === at)?.id ?? null),
    work,
  };
}

describe("simulator invariants under random orders", () => {
  for (const seed of ["f1", "f2", "f3", "f4", "f5", "f6"]) {
    it(`holds every physical invariant and replays exactly (seed ${seed})`, () => {
      const scenario = buildSyntheticScenario();
      const inc = new Incident({ scenario, seed });
      const road = new RoadIndex(scenario.map);
      const rng = new Rng(seed.charCodeAt(1) * 7919);
      const required = new Map(scenario.map.sites.map((s) => [s.id as string, s.requiredWork]));
      let lastWork = new Map<string, number>();
      let lastDamage = new Map<string, number>();
      let burnedEver = new Set<string>();
      const lostAt = new Map<string, string>();
      while (!inc.ended) {
        if (inc.simTimeMs % 15_000 === 0) {
          for (const a of scenario.agents) {
            if (rng.next() < 0.4 && inc.projectAgent(a.id).state !== "lost") {
              const { plan, siteAtEnd, work } = randomPlan(rng, road, inc, a.id);
              inc.submit({
                kind: "commit_plan",
                agentId: a.id,
                plan,
                workSiteId: work > 0 && a.role === "protection_crew" && siteAtEnd !== null ? SiteId.parse(siteAtEnd) : null,
                mode: "normal",
              });
            }
          }
        }
        inc.advanceTo(inc.simTimeMs + SIM_DEFAULTS.stepMs);
        const truth = inc.truth();
        // Single-capacity exclusivity, work caps, monotone damage and work, permanent closures.
        const onCorridor = truth.agents.filter((a) => a.state !== "lost" && a.position.kind === "edge" && a.position.edgeId === "e-s-h");
        expect(onCorridor.length).toBeLessThanOrEqual(1);
        for (const s of truth.sites) {
          expect(s.completedWork).toBeLessThanOrEqual(required.get(s.id)! + 1e-9);
          expect(s.damage).toBeGreaterThanOrEqual(lastDamage.get(s.id) ?? 0);
          expect(s.damage).toBeLessThanOrEqual(1);
          expect(s.completedWork).toBeGreaterThanOrEqual(lastWork.get(s.id) ?? 0);
          if (s.destroyed) expect(s.damage).toBe(1);
          lastWork.set(s.id, s.completedWork);
          lastDamage.set(s.id, s.damage);
        }
        for (const e of burnedEver) expect(truth.closedEdges).toContain(e);
        burnedEver = new Set(truth.closedEdges);
        // A lost agent never moves or acts again.
        for (const a of truth.agents) {
          if (a.state !== "lost") continue;
          const here = JSON.stringify(a.position);
          expect(lostAt.get(a.id) ?? here).toBe(here);
          lostAt.set(a.id, here);
        }
      }
      expect(inc.end?.tick).toBeLessThanOrEqual(SIM_DEFAULTS.incidentHorizonMs);
      const replayed = replayRecord(recordOf(inc));
      expect(replayed.hashMatches).toBe(true);
      expect(replayed.firstDivergenceMs).toBeNull();
      lastWork = new Map();
      lastDamage = new Map();
    });
  }
});
