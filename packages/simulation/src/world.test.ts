import { describe, expect, it } from "vitest";
import { AgentId, NodeId, SiteId } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario, type SimScenario } from "./index.js";
import { RoadIndex, cellIndexOf } from "./model/index.js";

const slow = { spreadMultiplier: 0.01, windShiftMs: 10_000_000, initialWindRad: 0 };
const normal = { spreadMultiplier: 1, windShiftMs: 10_000_000, initialWindRad: 0 };
const siteA = SiteId.parse("site-a");

function at(x: number, y: number): number {
  const c = cellIndexOf(x, y);
  if (c === null) throw new Error("off grid");
  return c;
}

function scenarioWith(opts: {
  agents: { id: string; start: string }[];
  fire: number[];
  siteWork?: number;
}): SimScenario {
  const base = buildSyntheticScenario({ sites: ["site-a"] });
  const proto = buildSyntheticScenario();
  return {
    ...base,
    agents: opts.agents.map((a) => {
      const found = proto.agents.find((p) => p.id === a.id);
      return { ...(found ?? proto.agents[0]!), id: AgentId.parse(a.id), startNodeId: NodeId.parse(a.start) };
    }),
    map: {
      ...base.map,
      initialFireCells: opts.fire,
      sites: base.map.sites.map((s) => ({ ...s, requiredWork: opts.siteWork ?? s.requiredWork })),
    },
  };
}

function workAtSite(inc: Incident, id: string, workMs: number, departMs = 0) {
  return authoredCommit({
    road: new RoadIndex(inc.scenario.map),
    agentId: AgentId.parse(id),
    planId: `work-${id}-${departMs}`,
    knowledgeRevision: inc.agentRevision(AgentId.parse(id)),
    startNode: NodeId.parse("n-sa"),
    departMs,
    approach: [],
    workSiteId: siteA,
    workMs,
    back: [],
  });
}

// Fire 17.7 m from site-a (inside the 35 m exposure radius) in a different cell than the node.
const nearSite = at(1187, 1062);

describe("work and damage", () => {
  it("adds the summed rates of two working crews and never exceeds required work", () => {
    const s = scenarioWith({ agents: [{ id: "crew-1", start: "n-sa" }, { id: "crew-2", start: "n-sa" }], fire: [at(30, 1500)] });
    const inc = new Incident({ scenario: s, seed: "w", overrides: slow });
    inc.submit(workAtSite(inc, "crew-1", 300_000));
    inc.submit(workAtSite(inc, "crew-2", 300_000));
    inc.advanceTo(100_000);
    expect(inc.truth().sites[0]?.completedWork).toBe(200);
    inc.advanceTo(200_000);
    expect(inc.truth().sites[0]?.completedWork).toBe(300);
    expect(inc.end?.matchingReasons).toContain("all_sites_resolved");
    expect(inc.end?.tick).toBe(150_000);
  });

  it("retains progress when a crew leaves and only current workers contribute", () => {
    const s = scenarioWith({ agents: [{ id: "crew-1", start: "n-sa" }, { id: "crew-2", start: "n-sa" }], fire: [at(30, 1500)] });
    const inc = new Incident({ scenario: s, seed: "w", overrides: slow });
    inc.submit(workAtSite(inc, "crew-1", 50_000));
    inc.advanceTo(100_000);
    expect(inc.truth().sites[0]?.completedWork).toBe(50);
    inc.submit(workAtSite(inc, "crew-2", 50_000, 100_000));
    inc.advanceTo(125_000);
    expect(inc.truth().sites[0]?.completedWork).toBe(75);
    inc.advanceTo(200_000);
    expect(inc.truth().sites[0]?.completedWork).toBe(100);
  });

  it("applies damage at 0.006 per exposed second, reduced linearly by protection", () => {
    const unprotected = new Incident({
      scenario: scenarioWith({ agents: [{ id: "crew-1", start: "n-rw" }], fire: [nearSite] }),
      seed: "d",
      overrides: slow,
    });
    unprotected.advanceTo(100_000);
    expect(unprotected.truth().sites[0]?.damage).toBeCloseTo(0.6, 9);

    const protectedRun = new Incident({
      scenario: scenarioWith({ agents: [{ id: "crew-1", start: "n-sa" }], fire: [nearSite] }),
      seed: "d",
      overrides: slow,
    });
    protectedRun.submit(workAtSite(protectedRun, "crew-1", 300_000));
    protectedRun.advanceTo(100_000);
    let expected = 0;
    for (let k = 1; k <= 100; k++) expected += 0.006 * (1 - (0.9 * k) / 300);
    expect(protectedRun.truth().sites[0]?.damage).toBeCloseTo(expected, 9);
  });

  it("stops new damage when exposure ceases and keeps accumulated damage", () => {
    const inc = new Incident({
      scenario: scenarioWith({ agents: [{ id: "crew-1", start: "n-sa" }], fire: [nearSite] }),
      seed: "d",
      overrides: slow,
    });
    inc.submit(workAtSite(inc, "crew-1", 300_000));
    inc.advanceTo(400_000);
    // The only burning cell expires at 240 s, so exposure ends and the fire is extinguished.
    expect(inc.end?.matchingReasons).toContain("fire_extinguished");
    expect(inc.end?.tick).toBe(240_000);
    let expected = 0;
    for (let k = 1; k <= 239; k++) expected += 0.006 * (1 - (0.9 * k) / 300);
    expect(inc.truth().sites[0]?.damage).toBeCloseTo(expected, 9);
    expect(inc.truth().sites[0]?.destroyed).toBe(false);
  });

  it("destroys an unprotected exposed site, which counts as resolved but never as saved", () => {
    const inc = new Incident({
      scenario: scenarioWith({ agents: [{ id: "crew-1", start: "n-rw" }], fire: [nearSite] }),
      seed: "d",
      overrides: slow,
    });
    inc.advanceTo(300_000);
    expect(inc.truth().sites[0]?.destroyed).toBe(true);
    expect(inc.truth().sites[0]?.completedWork).toBe(0);
    expect(inc.end?.matchingReasons).toContain("all_sites_resolved");
    expect(inc.end?.tick).toBe(167_000);
    expect(inc.notices.some((n) => n.kind === "site_resolved" && n.how === "destroyed")).toBe(true);
  });

  it("stores every ending reason from a simultaneous tick and applies the display precedence", () => {
    const inc = new Incident({
      scenario: scenarioWith({
        agents: [{ id: "crew-1", start: "n-sa" }],
        fire: [nearSite],
        siteWork: 240,
      }),
      seed: "d",
      overrides: slow,
    });
    inc.submit(workAtSite(inc, "crew-1", 300_000));
    inc.advanceTo(400_000);
    expect(inc.end?.tick).toBe(240_000);
    expect(inc.end?.matchingReasons).toEqual(["all_sites_resolved", "fire_extinguished"]);
    expect(inc.end?.displayReason).toBe("all_sites_resolved");
  });
});

describe("destroyed sites", () => {
  it("accept no further useful work once destroyed, and keep the failed outcome", () => {
    const base = buildSyntheticScenario({ sites: ["site-a", "site-b"] });
    const scenario: SimScenario = {
      ...base,
      agents: [{ ...base.agents[0]!, id: AgentId.parse("crew-1"), startNodeId: NodeId.parse("n-sa") }],
      map: { ...base.map, initialFireCells: [nearSite] },
    };
    const inc = new Incident({ scenario, seed: "late", overrides: slow });
    // Site A burns unprotected and is destroyed at about 167 s; a crew is only sent to work there afterwards.
    inc.advanceTo(190_000);
    expect(inc.truth().sites.find((s) => s.id === "site-a")?.destroyed).toBe(true);
    inc.submit(workAtSite(inc, "crew-1", 100_000, 190_000));
    inc.advanceTo(400_000);
    const a = inc.truth().sites.find((s) => s.id === "site-a")!;
    expect(a.destroyed).toBe(true);
    expect(a.completedWork).toBe(0);
    // Site B is unresolved, so only the lone burning cell burning out (240 s) ends the incident.
    expect(inc.end?.matchingReasons).toEqual(["fire_extinguished"]);
  });
});

describe("losses", () => {
  const road = (inc: Incident) => new RoadIndex(inc.scenario.map);

  it("loses a crew that moves into an actively burning cell", () => {
    const s = scenarioWith({ agents: [{ id: "crew-1", start: "n-rw" }], fire: [at(300, 830)] });
    const inc = new Incident({ scenario: s, seed: "l", overrides: normal });
    inc.submit(
      authoredCommit({
        road: road(inc),
        agentId: AgentId.parse("crew-1"),
        planId: "p",
        knowledgeRevision: inc.agentRevision(AgentId.parse("crew-1")),
        startNode: NodeId.parse("n-rw"),
        departMs: 0,
        approach: ["e-rw-j1", "e-j1-s"],
        workSiteId: null,
        workMs: 0,
        back: [],
      }),
    );
    inc.advanceTo(100_000);
    expect(inc.projectAgent(AgentId.parse("crew-1")).state).toBe("lost");
    // The adjacent cell ignites the road cell at x 300-325 m as the crew arrives (~57 s).
    expect(inc.notices.find((n) => n.kind === "agent_lost")?.tick).toBe(57_000);
    expect(inc.end?.matchingReasons).toContain("all_protection_crews_lost");
  });

  it("ends the incident when all crews are lost while a legacy scout (old replays) survives and is recorded alive", () => {
    const base = scenarioWith({ agents: [{ id: "crew-1", start: "n-rw" }], fire: [at(300, 830)] });
    // New scenarios have no scout; old replay scenarios still do, so build one by hand.
    const s = { ...base, agents: [...base.agents, { id: AgentId.parse("scout"), role: "scout" as const, callsign: "Scout", startNodeId: NodeId.parse("n-rs") }] };
    const inc = new Incident({ scenario: s, seed: "l", overrides: normal });
    inc.submit(
      authoredCommit({
        road: road(inc),
        agentId: AgentId.parse("crew-1"),
        planId: "p",
        knowledgeRevision: inc.agentRevision(AgentId.parse("crew-1")),
        startNode: NodeId.parse("n-rw"),
        departMs: 0,
        approach: ["e-rw-j1"],
        workSiteId: null,
        workMs: 0,
        back: [],
      }),
    );
    inc.advanceTo(200_000);
    expect(inc.end?.displayReason).toBe("all_protection_crews_lost");
    expect(inc.end?.tick).toBeLessThan(100_000);
    const view = inc.projectCoordinator();
    expect(view.agents.find((a) => a.id === "scout")?.state).not.toBe("lost");
    expect(view.agents.find((a) => a.id === "crew-1")?.state).toBe("lost");
  });

  it("does not remove an agent that only stands near fire", () => {
    const s = scenarioWith({ agents: [{ id: "crew-1", start: "n-rw" }], fire: [at(150, 800)] });
    const inc = new Incident({ scenario: s, seed: "l", overrides: slow });
    inc.advanceTo(100_000);
    expect(inc.projectAgent(AgentId.parse("crew-1")).state).toBe("idle");
  });

  it("closes a road permanently once its cells ignite", () => {
    const s = scenarioWith({ agents: [{ id: "crew-1", start: "n-rw" }], fire: [at(200, 800)] });
    const inc = new Incident({ scenario: s, seed: "l", overrides: slow });
    inc.advanceTo(300_000);
    expect(inc.truth().closedEdges).toContain("e-rw-j1");
    inc.advanceTo(400_000);
    expect(inc.truth().closedEdges).toContain("e-rw-j1");
  });
});

describe("deadline and clock", () => {
  it("rejects input after the real play limit and still finalizes through tick 1500", () => {
    const inc = new Incident({ scenario: buildSyntheticScenario(), seed: "c" });
    inc.advanceTo(100_000);
    inc.setWallElapsed(300_000);
    const receipt = inc.submit({ kind: "set_active_recipient", recipientId: AgentId.parse("crew-1") });
    expect(receipt).toEqual({ accepted: false, status: "input_closed", ordinal: null });
    inc.advanceTo(10_000_000);
    expect(inc.end?.tick).toBeLessThanOrEqual(1_500_000);
    expect(inc.projectCoordinator().activeRecipientId).toBeNull();
  });

  it("rejects input once the incident has ended", () => {
    const inc = new Incident({ scenario: buildSyntheticScenario(), seed: "c" });
    inc.advanceTo(10_000_000);
    expect(inc.ended).toBe(true);
    expect(inc.submit({ kind: "set_active_recipient", recipientId: null }).status).toBe("incident_ended");
    expect(inc.end?.tick).toBeLessThanOrEqual(1_500_000);
  });
});
