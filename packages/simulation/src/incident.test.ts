import { describe, expect, it } from "vitest";
import { AgentId, NodeId, SiteId, type CoordinatorView } from "@ember/domain";
import {
  Incident,
  authoredCommit,
  buildSyntheticScenario,
  recordOf,
  replayRecord,
  type SimScenario,
} from "./index.js";
import { RoadIndex, cellIndexOf } from "./model/index.js";

const crew1 = AgentId.parse("crew-1");
const siteA = SiteId.parse("site-a");
const noWindShift = { windShiftMs: 10_000_000, spreadMultiplier: 1, initialWindRad: 0 };

function small(fireCells?: number[]): SimScenario {
  const s = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] });
  if (fireCells === undefined) return s;
  return { ...s, map: { ...s.map, initialFireCells: fireCells } };
}

function farFire(): number[] {
  // Far north-west corner: nothing is near any road, site or agent.
  return [cellIndexOf(30, 1500)!];
}

function mission(inc: Incident, over: { work?: number; depart?: number } = {}) {
  const road = new RoadIndex(inc.scenario.map);
  return authoredCommit({
    road,
    agentId: crew1,
    planId: "plan-1",
    knowledgeRevision: inc.agentRevision(crew1),
    startNode: NodeId.parse("n-rw"),
    departMs: over.depart ?? 0,
    approach: ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"],
    workSiteId: siteA,
    workMs: over.work ?? 300_000,
    back: ["e-h-sa", "e-s-h", "e-j1-s", "e-rw-j1"],
  });
}

describe("incident basics", () => {
  it("starts at time zero with the crew idle at its refuge", () => {
    const inc = new Incident({ scenario: small(), seed: "s", overrides: noWindShift });
    const view = inc.projectCoordinator();
    expect(view.simTimeMs).toBe(0);
    expect(view.incidentStatus).toBe("active");
    expect(view.agents[0]?.state).toBe("idle");
    expect(view.agents[0]?.position).toEqual({ kind: "node", nodeId: "n-rw" });
  });

  it("moves a committed crew along its route at 4 m per simulated second", () => {
    const inc = new Incident({ scenario: small(farFire()), seed: "s", overrides: noWindShift });
    inc.submit(mission(inc));
    inc.advanceTo(10_000);
    const pos = inc.projectAgent(crew1).position;
    expect(pos.kind).toBe("edge");
    if (pos.kind === "edge") {
      expect(pos.edgeId).toBe("e-rw-j1");
      expect(pos.distanceAlongPolyline).toBeCloseTo(40, 6);
    }
    expect(inc.projectAgent(crew1).state).toBe("approaching");
    inc.advanceTo(75_000);
    expect(inc.projectAgent(crew1).position).toEqual({ kind: "node", nodeId: "n-j1" });
  });

  it("completes work, returns to the refuge and goes idle", () => {
    const inc = new Incident({ scenario: small(farFire()), seed: "s", overrides: noWindShift });
    inc.submit(mission(inc, { work: 100_000 }));
    inc.advanceTo(400_000);
    const truth = inc.truth();
    const site = truth.sites.find((s) => s.id === "site-a");
    expect(site?.completedWork).toBeGreaterThan(0);
    expect(site?.completedWork).toBeLessThanOrEqual(100);
    expect(inc.projectAgent(crew1).state).toBe("working");
    inc.advanceTo(1_000_000);
    expect(inc.projectAgent(crew1).position).toEqual({ kind: "node", nodeId: "n-rw" });
    expect(inc.projectAgent(crew1).state).toBe("idle");
    expect(inc.notices.some((n) => n.kind === "plan_complete")).toBe(true);
  });

  it("ends immediately when all sites are protected, even with the crew away from refuge", () => {
    const inc = new Incident({ scenario: small(farFire()), seed: "s", overrides: noWindShift });
    inc.submit(mission(inc, { work: 300_000 }));
    inc.advanceTo(1_500_000);
    expect(inc.end?.matchingReasons).toContain("all_sites_resolved");
    expect(inc.end?.displayReason).toBe("all_sites_resolved");
    // Work starts at ~ tick 335 and needs 300 s, so the end is well before the return completes.
    expect(inc.end?.tick).toBeLessThan(700_000);
    // The mission was cut off by the incident ending: it is recorded as interrupted, and no
    // successful return is invented for it.
    expect(inc.notices.some((n) => n.kind === "plan_interrupted_by_end" && n.agentId === "crew-1")).toBe(true);
    expect(inc.notices.some((n) => n.kind === "plan_complete")).toBe(false);
  });

  it("rejects a plan built on stale knowledge and keeps the previous state", () => {
    const inc = new Incident({ scenario: small(farFire()), seed: "s", overrides: noWindShift });
    const stale = mission(inc);
    inc.advanceTo(5000);
    // Revision changed? Only if new observations arrived; force by moving near new cells.
    inc.submit({ ...stale, plan: { ...stale.plan, knowledgeRevision: stale.plan.knowledgeRevision + 99 as never } });
    inc.advanceTo(6000);
    expect(inc.notices.some((n) => n.kind === "plan_rejected" && n.reason === "stale_knowledge")).toBe(true);
    expect(inc.projectAgent(crew1).commitment).toBeNull();
  });
});

describe("determinism", () => {
  it("reproduces an identical result from the same seed, scenario and input log", () => {
    const run = (): Incident => {
      const inc = new Incident({ scenario: buildSyntheticScenario(), seed: "repeat" });
      inc.submit(mission(inc));
      inc.advanceTo(600_000);
      return inc;
    };
    const a = run();
    const b = run();
    expect(a.snapshotHash()).toBe(b.snapshotHash());
    const replayed = replayRecord(recordOf(a));
    expect(replayed.hashMatches).toBe(true);
    expect(replayed.firstDivergenceMs).toBeNull();
    expect(replayed.incident.snapshotHash()).toBe(a.snapshotHash());
  });

  it("diverges when the seed changes", () => {
    const run = (seed: string): string => {
      const inc = new Incident({ scenario: buildSyntheticScenario(), seed });
      inc.advanceTo(300_000);
      return inc.snapshotHash();
    };
    expect(run("one")).not.toBe(run("two"));
  });

  it("detects a tampered record through checkpoints", () => {
    const inc = new Incident({ scenario: buildSyntheticScenario(), seed: "t" });
    inc.advanceTo(250_000);
    const record = recordOf(inc);
    const tampered = { ...record, seed: "other" };
    const replayed = replayRecord(tampered);
    expect(replayed.hashMatches).toBe(false);
    expect(replayed.firstDivergenceMs).not.toBeNull();
  });
});

describe("information boundary", () => {
  it("never puts private parameters or truth cells in the coordinator projection", () => {
    const inc = new Incident({ scenario: buildSyntheticScenario(), seed: "secret-seed-123" });
    inc.advanceTo(200_000);
    const text = JSON.stringify(inc.projectCoordinator());
    for (const forbidden of ["secret-seed-123", "spreadMultiplier", "windShift", "privateWorld", "ignitedAt", "requiredWork"]) {
      expect(text).not.toContain(forbidden);
    }
    const view: CoordinatorView = inc.projectCoordinator();
    // Fire the coordinator has not observed is absent: only the briefed patch is known burning.
    const burning = view.observedCells.filter((c) => c.burnState === "burning");
    expect(burning.length).toBeGreaterThanOrEqual(4);
    expect(burning.length).toBeLessThan(40);
  });

  it("gives crews identical inputs when only hidden parameters differ and nothing new is seen", () => {
    const make = (mult: number): Incident =>
      new Incident({ scenario: buildSyntheticScenario(), seed: "a", overrides: { spreadMultiplier: mult, windShiftMs: 300_000 + mult * 1000 } });
    const a = make(0.7);
    const b = make(1.5);
    a.advanceTo(60_000);
    b.advanceTo(60_000);
    expect(a.projectAgent(crew1).inputHash).toBe(b.projectAgent(crew1).inputHash);
    expect(a.truth().cellState).not.toEqual(b.truth().cellState);
  });
});

describe("knowledge scoping and relay", () => {
  function scoutScenario(): SimScenario {
    const base = buildSyntheticScenario({ agents: ["crew-1", "scout"], sites: ["site-a"] });
    const scout = base.agents.find((a) => a.id === "scout")!;
    return {
      ...base,
      agents: base.agents.map((a) => (a.id === "scout" ? { ...scout, startNodeId: NodeId.parse("n-j1") } : a)),
      map: { ...base.map, initialFireCells: [cellIndexOf(450, 850)!] },
    };
  }

  it("keeps a scout observation with the coordinator until it is relayed to one crew", () => {
    const inc = new Incident({ scenario: scoutScenario(), seed: "k", overrides: { spreadMultiplier: 1, windShiftMs: 1e9, initialWindRad: 0 } });
    const crewHashBefore = inc.projectAgent(crew1).inputHash;
    inc.advanceTo(90_000);
    const scoutObs = inc.coordinator
      .observations()
      .filter((o) => o.sourceAgentId === "scout" && o.observedFields.some((f) => f.kind === "cell" && f.burnState === "burning"))
      .at(-1);
    expect(scoutObs).toBeDefined();
    const burningCell = scoutObs!.observedFields.find((f) => f.kind === "cell" && f.burnState === "burning");
    const cell = burningCell && burningCell.kind === "cell" ? burningCell.cellIndex : -1;
    // Coordinator knows; the crew does not and its planning input is unchanged.
    expect(inc.coordinator.cellBelief(cell)?.state).toBe("burning");
    expect(inc.agentStores.get(crew1)?.cellBelief(cell)).toBeUndefined();
    expect(inc.projectAgent(crew1).inputHash).toBe(crewHashBefore);

    inc.submit({ kind: "relay", observationId: scoutObs!.id, toAgentId: crew1 });
    inc.advanceTo(95_000);
    const belief = inc.agentStores.get(crew1)?.cellBelief(cell);
    expect(belief?.state).toBe("burning");
    expect(belief?.provenance).toBe("relay");
    expect(belief?.sourceAgentId).toBe("scout");
    expect(belief?.observedAt).toBe(scoutObs!.observedAt);
    expect(belief?.receivedAt).toBe(91_000);
    expect(inc.projectAgent(crew1).inputHash).not.toBe(crewHashBefore);
    // Other agents stay unchanged by a targeted relay.
    expect(inc.projectAgent(AgentId.parse("scout")).knowledge.observations.every((o) => o.sourceAgentId !== "crew-1")).toBe(true);
  });

  it("does not create a fabricated observation for an unknown relay id", () => {
    const inc = new Incident({ scenario: scoutScenario(), seed: "k", overrides: { spreadMultiplier: 1, windShiftMs: 1e9, initialWindRad: 0 } });
    const before = inc.projectAgent(crew1).knowledge.observations.length;
    inc.submit({ kind: "relay", observationId: "obs:does-not-exist", toAgentId: crew1 });
    inc.advanceTo(2000);
    expect(inc.projectAgent(crew1).knowledge.observations.length).toBe(before);
  });
});
