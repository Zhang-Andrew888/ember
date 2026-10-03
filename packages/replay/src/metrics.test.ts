import { describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, SiteId } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario, recordOf } from "@ember/simulation";
import { RoadIndex, cellIndexOf } from "@ember/simulation/model";
import { BundleReplayReader, computeMetrics, parseBundle, percentile, serializeBundle, summarize, type DecisionLike, type RunBundle } from "./index.js";

vi.setConfig({ testTimeout: 60_000 });

const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };
const far = [cellIndexOf(30, 1500)!];

function scenario(sites = ["site-a"], agents = ["crew-1"]) {
  const base = buildSyntheticScenario({ agents, sites });
  return { ...base, map: { ...base.map, initialFireCells: far } };
}

function mission(inc: Incident, workMs: number, id = "m1") {
  return authoredCommit({
    road: new RoadIndex(inc.scenario.map),
    agentId: AgentId.parse("crew-1"),
    planId: id,
    knowledgeRevision: inc.agentRevision(AgentId.parse("crew-1")),
    startNode: NodeId.parse("n-rw"),
    departMs: 0,
    approach: ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"],
    workSiteId: SiteId.parse("site-a"),
    workMs,
    back: ["e-h-sa", "e-s-h", "e-j1-s", "e-rw-j1"],
  });
}

describe("run metrics", () => {
  it("counts a completed return separately from an interrupted mission", () => {
    const returned = new Incident({ scenario: scenario(), seed: "m", overrides: calm });
    returned.submit(mission(returned, 60_000));
    returned.advanceTo(900_000);
    const m1 = computeMetrics({ incident: returned, decisions: [] });
    expect(m1.missionsStarted).toBe(1);
    expect(m1.returnsCompleted).toBe(1);
    expect(m1.interruptedByIncidentEnd).toBe(0);
    // Physical arrival is a few seconds ahead of the bucketed plan, so work starts on arrival.
    expect(m1.protectionWorkDelivered).toBeGreaterThanOrEqual(60);
    expect(m1.protectionWorkDelivered).toBeLessThanOrEqual(75);

    // Work that finishes the only site ends the incident with the crew away: interrupted, not returned.
    const cut = new Incident({ scenario: scenario(), seed: "m", overrides: calm });
    cut.submit(mission(cut, 300_000));
    cut.advanceTo(1_500_000);
    const m2 = computeMetrics({ incident: cut, decisions: [] });
    expect(m2.returnsCompleted).toBe(0);
    expect(m2.interruptedByIncidentEnd).toBe(1);
    expect(m2.missionsStarted).toBe(1);
    expect(m2.sitesProtectedAndStanding).toBe(1);
    expect(m2.endingReasons).toContain("all_sites_resolved");
    expect(m2.simSeconds).toBeLessThan(1500);
  });

  it("reports losses, destroyed sites and ending reasons without hiding them", () => {
    const base = buildSyntheticScenario({ agents: ["crew-1", "scout"], sites: ["site-a"] });
    const s = { ...base, map: { ...base.map, initialFireCells: [cellIndexOf(300, 830)!] } };
    const inc = new Incident({ scenario: s, seed: "loss", overrides: { spreadMultiplier: 1, windShiftMs: 1e9, initialWindRad: 0 } });
    inc.submit(
      authoredCommit({
        road: new RoadIndex(inc.scenario.map),
        agentId: AgentId.parse("crew-1"),
        planId: "walk",
        knowledgeRevision: inc.agentRevision(AgentId.parse("crew-1")),
        startNode: NodeId.parse("n-rw"),
        departMs: 0,
        approach: ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"],
        workSiteId: SiteId.parse("site-a"),
        workMs: 60_000,
        back: ["e-h-sa", "e-s-h", "e-j1-s", "e-rw-j1"],
      }),
    );
    inc.advanceTo(200_000);
    const m = computeMetrics({ incident: inc, decisions: [] });
    expect(m.crewsLost).toBe(1);
    expect(m.crewsLiving).toBe(0);
    expect(m.scoutLost).toBe(false);
    expect(m.lostBeforeReturn).toBe(1);
    expect(m.displayReason).toBe("all_protection_crews_lost");
  });

  it("measures stranded intervals and survival-response counts from decisions, independent of outcome", () => {
    const inc = new Incident({ scenario: scenario(), seed: "m", overrides: calm });
    inc.advanceTo(100_000);
    const decisions: DecisionLike[] = [
      { tick: 20_000, agentId: "crew-1", type: "stranded_reported", reasonCode: "no_known_passable_route" },
      { tick: 70_000, agentId: "crew-1", type: "withdrawal_triggered", reasonCode: "forecast_leg_unsafe" },
      { tick: 80_000, agentId: "crew-1", type: "objective_rejected", reasonCode: "x" },
    ];
    const m = computeMetrics({ incident: inc, decisions });
    expect(m.strandedSeconds).toBe(50);
    expect(m.withdrawals).toBe(1);
    expect(m.refusals).toBe(1);
    expect(m.returnPlanFailures).toBe(1);
  });

  it("summarizes runs and keeps interrupted and superseded counts beside returns", () => {
    const a = new Incident({ scenario: scenario(), seed: "m", overrides: calm });
    a.submit(mission(a, 60_000));
    a.advanceTo(900_000);
    const runs = [computeMetrics({ incident: a, decisions: [] }), computeMetrics({ incident: a, decisions: [] })];
    const s = summarize(runs);
    expect(s.runs).toBe(2);
    expect(s.totalMissionsStarted).toBe(2);
    expect(s.totalReturnsCompleted).toBe(2);
    expect(s.totalInterrupted).toBe(0);
    expect(percentile([5, 1, 9, 3], 50)).toBe(3);
    expect(percentile([], 95)).toBe(0);
  });
});

describe("bundle replay", () => {
  it("plays back recorded world events and decisions in time order and rebuilds the final view", async () => {
    const inc = new Incident({ scenario: scenario(), seed: "bundle", overrides: calm });
    inc.submit(mission(inc, 60_000));
    inc.advanceTo(400_000);
    const bundle: RunBundle = {
      format: "ember-run-bundle-v1",
      record: recordOf(inc),
      decisions: [
        {
          sequence: 0 as never,
          tick: 0 as never,
          agentId: AgentId.parse("crew-1"),
          type: "mission_start",
          reasonCode: "mission_admitted",
          evidenceIds: [],
          actualAction: "heading to Ridge Cabins",
        },
      ],
      policy: { name: "scripted-relay", version: "1" },
      policyLog: [],
    };
    const round = parseBundle(serializeBundle(bundle));
    const reader = new BundleReplayReader(round);
    const kinds: string[] = [];
    let last = -1;
    for await (const e of reader.readEvents()) {
      kinds.push(e.kind);
      const at = e.kind === "observation" ? e.payload.observedAt : e.kind === "decision" ? e.payload.tick : 0;
      if (e.kind !== "incident_end") {
        expect(at).toBeGreaterThanOrEqual(last);
        last = at;
      }
    }
    expect(kinds[0]).toBe("decision");
    expect(kinds).toContain("observation");
    const view = await reader.buildFinalView();
    expect(view.simTimeMs).toBe(inc.simTimeMs);
    expect(JSON.stringify(view)).toBe(JSON.stringify(inc.projectCoordinator()));
  });
});
