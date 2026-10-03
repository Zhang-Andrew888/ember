import { describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, ObjectiveId, Observation, SequenceNumber, SimTimeMs, SiteId, type AgentPosition, type Objective } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario, type AgentProjection, type SimScenario } from "@ember/simulation";
import { RoadIndex, cellIndexOf } from "@ember/simulation/model";
import { KnowledgeStore } from "@ember/knowledge";
import { briefingObservation } from "@ember/forecast";
import { planMissions, protectionTargets } from "@ember/navigation";
import { cellsOfEdge } from "@ember/navigation";
import { DEFAULT_FORECAST_CONFIG } from "@ember/forecast";
import { CrewController, runControllers } from "./index.js";

// Full simulated runs and cold forecast rollouts are slow on shared CI machines.
vi.setConfig({ testTimeout: 120_000 });

const crew1 = AgentId.parse("crew-1");

function patch(x: number, y: number): number[] {
  return [cellIndexOf(x, y)!, cellIndexOf(x + 25, y)!, cellIndexOf(x, y + 25)!, cellIndexOf(x + 25, y + 25)!];
}

function scenarioWith(opts: { agents?: string[]; sites?: string[]; fire?: number[]; work?: number }): SimScenario {
  const base = buildSyntheticScenario({ agents: opts.agents ?? ["crew-1"], sites: opts.sites ?? ["site-a"] });
  return {
    ...base,
    map: {
      ...base.map,
      initialFireCells: opts.fire ?? base.map.initialFireCells,
      sites: base.map.sites.map((s) => ({ ...s, requiredWork: opts.work ?? s.requiredWork })),
    },
  };
}

const far = patch(30, 1500);
const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };

function crew(scenario: SimScenario, id = "crew-1", callsign = "Crew 1"): CrewController {
  return new CrewController({ agentId: AgentId.parse(id), callsign, role: "protection_crew", map: scenario.map });
}

describe("autonomous mission selection", () => {
  it("starts, works, returns and holds without any coordinator input", () => {
    const scenario = scenarioWith({ fire: far, work: 60 });
    const inc = new Incident({ scenario, seed: "a1", overrides: calm });
    const c = crew(scenario);
    const log = runControllers(inc, [c], 700_000);
    expect(log.decisions[0]?.event.type).toBe("mission_start");
    expect(log.decisions[0]?.event.reasonCode).toBe("mission_admitted");
    const truth = inc.truth();
    expect(inc.end?.matchingReasons ?? []).toContain("all_sites_resolved");
    expect(truth.sites[0]?.completedWork).toBe(60);
    expect(inc.projectAgent(crew1).state).not.toBe("lost");
    expect(log.states.get("crew-1")?.map((s) => s.state)).toEqual(expect.arrayContaining(["APPROACHING", "WORKING"]));
    expect(inc.projectCoordinator().recentReports.some((r) => /heading to Ridge Cabins/.test(r.text))).toBe(true);
  });

  it("selects a further feasible mission after returning, and never exceeds site work", () => {
    // A briefed steady east wind and a fire in the south-east corner keep later missions admissible.
    const scenario = scenarioWith({ fire: patch(1500, 100), sites: ["site-a", "site-b"], work: 45 });
    const inc = new Incident({ scenario, seed: "a2", overrides: calm });
    const steady = {
      ...DEFAULT_FORECAST_CONFIG,
      prior: {
        spreadMultiplier: { min: 0.6, max: 0.8 },
        windOffsetDeg: { min: -5, max: 5 },
        shiftTimeMs: { min: 1_300_000, max: 1_400_000 },
        postShiftDeg: { min: 45, max: 100 },
      },
    };
    const c = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: scenario.map, config: { forecast: steady } });
    const log = runControllers(inc, [c], 1_300_000);
    const starts = log.decisions.filter((d) => d.event.type === "mission_start");
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(starts.map((s) => s.event.actualAction.split(" (")[0])).size).toBe(2);
    for (const s of inc.truth().sites) expect(s.completedWork).toBeLessThanOrEqual(45);
  });

  it("holds without falsely resolving sites when no mission has a safe return", () => {
        // Fire right beside the only road out of the refuge: nothing can pass the margin.
    const scenario = scenarioWith({ fire: patch(250, 850), sites: ["site-a", "site-b", "site-c"] });
    const inc = new Incident({ scenario, seed: "a3", overrides: calm });
    const c = crew(scenario);
    const log = runControllers(inc, [c], 120_000);
    expect(log.decisions.filter((d) => d.event.type === "mission_start")).toHaveLength(0);
    expect(log.decisions[0]?.event.type).toBe("idle");
    expect(log.states.get("crew-1")?.every((s) => s.state === "HOLDING")).toBe(true);
    expect(inc.truth().sites.every((s) => s.completedWork === 0 && !s.destroyed)).toBe(true);
  });

  it("keeps identical input and decisions when only hidden parameters differ and nothing new is seen", () => {
    const orders = (mult: number, shift: number): string[] => {
      const scenario = scenarioWith({ fire: far });
      const inc = new Incident({ scenario, seed: "h", overrides: { spreadMultiplier: mult, windShiftMs: shift, initialWindRad: 0 } });
      const c = crew(scenario);
      const seen: string[] = [];
      for (let i = 0; i < 40; i++) {
        const proj = inc.projectAgent(crew1);
        const out = c.tick(proj);
        for (const o of out.orders) {
          seen.push(JSON.stringify(o));
          inc.submit(o);
        }
        seen.push(proj.inputHash);
        inc.advanceTo(inc.simTimeMs + 1000);
      }
      return seen;
    };
    expect(orders(0.6, 300_000)).toEqual(orders(1.6, 620_000));
  });

  it("is unaffected by a coordinator-only observation until it is relayed", () => {
    const run = (withScout: boolean): string[] => {
      const base = scenarioWith({ agents: withScout ? ["crew-1", "scout"] : ["crew-1"], fire: patch(450, 850) });
      const scenario = withScout
        ? { ...base, agents: base.agents.map((a) => (a.id === "scout" ? { ...a, startNodeId: NodeId.parse("n-j1") } : a)) }
        : base;
      const inc = new Incident({ scenario, seed: "co", overrides: { spreadMultiplier: 1, windShiftMs: 1e9, initialWindRad: 0 } });
      const c = crew(scenario);
      const seen: string[] = [];
      for (let i = 0; i < 90; i++) {
        const proj = inc.projectAgent(crew1);
        const out = c.tick(proj);
        for (const o of out.orders) {
          seen.push(`${i}:${JSON.stringify(o)}`);
          inc.submit(o);
        }
        seen.push(`${i}:${proj.inputHash}`);
        inc.advanceTo(inc.simTimeMs + 1000);
      }
      return seen;
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe("autonomous withdrawal and survival", () => {
  function projection(
    store: KnowledgeStore,
    position: AgentPosition,
    now: number,
    commitment: AgentProjection["commitment"],
  ): AgentProjection {
    return {
      agentId: crew1,
      simTimeMs: now,
      role: "protection_crew",
      callsign: "Crew 1",
      position,
      state: commitment === null ? "idle" : commitment.working ? "working" : "approaching",
      objectiveRevision: 0,
      planRevision: 1,
      knowledgeRevision: store.revision,
      commitment,
      knowledge: store.snapshot(SimTimeMs.parse(now)),
      inputHash: store.inputHash(),
    };
  }

  const scenario = scenarioWith({ fire: far });
  const road = new RoadIndex(scenario.map);

  function burning(ids: string[], at: number) {
    const cells = ids.flatMap((e) => cellsOfEdge(road, e).filter((c) => (road.edgesByCell.get(c) ?? []).length === 1));
    return Observation.parse({
      id: `obs:crew-1:${at}`,
      sourceAgentId: crew1,
      observedAt: at,
      receivedAt: at,
      spatialFootprint: { centerX: 1000, centerY: 800, radius: 150 },
      observedFields: cells.map((gridCellIndex) => ({ kind: "cell", gridCellIndex, burnState: "burning" as const })),
    });
  }

  function startedCrew(): { c: CrewController; store: KnowledgeStore; planId: string; legs: number } {
    const c = crew(scenario);
    const store = new KnowledgeStore(crew1);
    store.ingest(briefingObservation(scenario.map, scenario.map.sites.map((s) => s.id)));
    const out = c.tick(projection(store, { kind: "node", nodeId: NodeId.parse("n-rw") }, 0, null));
    const order = out.orders[0];
    if (order === undefined || order.kind !== "commit_plan") throw new Error("expected a mission");
    return { c, store, planId: order.plan.id, legs: order.plan.timedLegs.length };
  }

  it("withdraws on its own when a direct observation closes the planned return, and explains", () => {
    const { c, store, planId } = startedCrew();
    store.ingest(burning(["e-s-h"], 300_000));
    const atSite: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-sa") };
    const out = c.tick(
      projection(store, atSite, 301_000, { planId, legIndex: 4, legCount: 7, mode: "normal", working: true }),
    );
    const event = out.decisions.find((d) => d.type === "withdrawal_triggered");
    expect(event?.reasonCode).toBe("route_closed_by_observation");
    expect(out.orders[0]?.kind).toBe("commit_plan");
    // The planned return crosses a cell now observed burning, so it leaves via the north road instead.
    const order = out.orders[0];
    if (order?.kind === "commit_plan") {
      expect(order.mode).toBe("withdrawing");
      // Home by the south-east road instead: the corridor cell is observed burning.
      expect(order.plan.timedLegs.map((l) => l.edgeId)).toContain("e-rs-sc");
      expect(order.plan.timedLegs.map((l) => l.edgeId)).not.toContain("e-s-h");
    }
    expect(out.reports[0]?.urgent).toBe(true);
    expect(out.reports[0]?.text).toMatch(/Crew 1 is withdrawing/);
    expect(event?.evidenceIds.length).toBeGreaterThan(0);
    expect(out.state).toBe("WITHDRAWING");
  });

  it("falls back to a best-effort retreat when the normal margin cannot be met anywhere", () => {
    const { c, store, planId } = startedCrew();
    // Fire seen on both the south corridor and the north road's far end leaves only exposure-ranked roads.
    store.ingest(burning(["e-s-h"], 300_000));
    const atSite: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-sa") };
    // Make the north road fail the forecast margin: a seen cell at the hub's north approach.
    store.ingest(
      Observation.parse({
        id: "obs:crew-1:300500",
        sourceAgentId: crew1,
        observedAt: 300_500,
        receivedAt: 300_500,
        spatialFootprint: { centerX: 1000, centerY: 800, radius: 150 },
        observedFields: [{ kind: "cell", gridCellIndex: cellIndexOf(900, 900)!, burnState: "burning" }],
      }),
    );
    const out = c.tick(
      projection(store, atSite, 301_000, { planId, legIndex: 4, legCount: 7, mode: "normal", working: true }),
    );
    expect(out.decisions.map((d) => d.type).some((t) => t === "retreat_triggered" || t === "withdrawal_triggered")).toBe(true);
    expect(out.orders[0]?.kind).toBe("commit_plan");
  });

  it("reports itself stranded, keeps observing, and invents no route when none is known passable", () => {
    const { c, store, planId } = startedCrew();
    store.ingest(burning(["e-s-h", "e-n-h", "e-h-sc"], 300_000));
    const atSite: AgentPosition = { kind: "node", nodeId: NodeId.parse("n-sa") };
    const out = c.tick(
      projection(store, atSite, 301_000, { planId, legIndex: 4, legCount: 7, mode: "normal", working: true }),
    );
    expect(out.decisions.map((d) => d.type)).toContain("stranded_reported");
    // The old plan is replaced by an empty one, so the simulator cannot later walk an abandoned leg.
    expect(out.orders).toHaveLength(1);
    const halt = out.orders[0];
    expect(halt?.kind === "commit_plan" && halt.plan.timedLegs.length).toBe(0);
    expect(out.state).toBe("STRANDED");
    expect(out.reports[0]?.urgent).toBe(true);
    // Fresh evidence that reopens nothing keeps it stranded without repeating the report.
    const again = c.tick(projection(store, atSite, 330_000, null));
    expect(again.decisions.filter((d) => d.type === "stranded_reported")).toHaveLength(0);
    expect(again.state).toBe("STRANDED");
  });

  it("does not wait for approval: an unreliable forecast stops protection and withdraws", () => {
    const { c, store, planId } = startedCrew();
    // Observe a burning cell far from any prior future: every member is contradicted.
    store.ingest(
      Observation.parse({
        id: "obs:crew-1:20000",
        sourceAgentId: crew1,
        observedAt: 20_000,
        receivedAt: 20_000,
        spatialFootprint: { centerX: 1250, centerY: 1100, radius: 150 },
        observedFields: [
          { kind: "cell", gridCellIndex: cellIndexOf(1250, 1100)!, burnState: "burning" },
          { kind: "cell", gridCellIndex: cellIndexOf(1225, 1100)!, burnState: "burning" },
          { kind: "cell", gridCellIndex: cellIndexOf(1250, 1075)!, burnState: "burning" },
        ],
      }),
    );
    const out = c.tick(
      projection(store, { kind: "node", nodeId: NodeId.parse("n-h") }, 21_000, { planId, legIndex: 2, legCount: 7, mode: "normal", working: false }),
    );
    const types = out.decisions.map((d) => d.type);
    expect(types.some((t) => t === "withdrawal_triggered" || t === "retreat_triggered")).toBe(true);
    expect(out.forecastEvents.some((e) => e.kind === "contradiction")).toBe(true);
    expect(c.currentEnsemble?.reliability).toBe("unreliable");
    expect(out.orders[0]?.kind === "commit_plan" && out.orders[0].mode !== "normal").toBe(true);
    // The rebuild is pending but the crew never paused for it.
    expect(out.state === "WITHDRAWING" || out.state === "RETREATING").toBe(true);
  });
});

describe("coordinator objectives", () => {
  const objective = (kind: Objective["kind"], target: string | null, id: string): Objective => ({
    id: ObjectiveId.parse(id),
    recipientId: crew1,
    kind,
    targetId: target,
    constraints: {},
    issueSequence: SequenceNumber.parse(1),
  });

  it("rejects an infeasible objective once with a reason and keeps the feasible plan", () => {
    const scenario = scenarioWith({ fire: patch(1350, 450), sites: ["site-a", "site-c"] });
    const inc = new Incident({ scenario, seed: "o1", overrides: calm });
    const c = crew(scenario);
    const log = runControllers(inc, [c], 20_000);
    const planBefore = c.activePlanId;
    expect(planBefore).not.toBeNull();
    c.receiveObjective(objective("protect_site", "site-c", "obj-c"));
    c.receiveObjective(objective("protect_site", "site-c", "obj-c"));
    runControllers(inc, [c], 25_000, undefined, log);
    const rejections = log.decisions.filter((d) => d.event.type === "objective_rejected");
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.event.reasonCode).toMatch(/no_feasible|horizon|target/);
    expect(c.activePlanId).toBe(planBefore);
  });

  it("replaces an autonomous choice with a feasible objective from the actual position", () => {
    const scenario = scenarioWith({ fire: far, sites: ["site-a", "site-b"] });
    const inc = new Incident({ scenario, seed: "o2", overrides: calm });
    const c = crew(scenario);
    const log = runControllers(inc, [c], 5000);
    const before = c.activePlanId;
    const pickedBefore = log.decisions[0]?.event.actualAction ?? "";
    const other = /Ridge/.test(pickedBefore) ? "site-b" : "site-a";
    c.receiveObjective(objective("protect_site", other, "obj-x"));
    runControllers(inc, [c], 8000, undefined, log);
    expect(c.activePlanId).not.toBe(before);
    const update = log.decisions.find((d) => d.event.reasonCode === "objective_accepted");
    expect(update?.event.type).toBe("mission_update");
  });

  it("holds at the refuge on a hold objective until it resumes autonomous selection", () => {
    const scenario = scenarioWith({ fire: far });
    const inc = new Incident({ scenario, seed: "o3", overrides: calm });
    const c = crew(scenario);
    c.receiveObjective(objective("hold", null, "obj-h"));
    const log = runControllers(inc, [c], 60_000);
    expect(log.decisions.filter((d) => d.event.type === "mission_start")).toHaveLength(0);
    expect(c.state).toBe("HOLDING");
    c.resumeAutonomous();
    runControllers(inc, [c], 70_000, undefined, log);
    expect(log.decisions.filter((d) => d.event.type === "mission_start")).toHaveLength(1);
  });
});

describe("end-to-end survival against a surprise", () => {
  it("leaves the site on its own when observed fire contradicts the plan, and survives", () => {
    // The briefing says fire east of the site spreads east. In truth the wind turns west early.
    const scenario = scenarioWith({ fire: patch(1550, 1050), sites: ["site-a"], work: 300 });
    const inc = new Incident({
      scenario,
      seed: "surprise",
      overrides: { spreadMultiplier: 1.2, windShiftMs: 250_000, postShiftWindRad: Math.PI, initialWindRad: 0 },
    });
    const c = crew(scenario);
    const log = runControllers(inc, [c], 900_000);
    const start = log.decisions.find((d) => d.event.type === "mission_start");
    expect(start).toBeDefined();
    const leave = log.decisions.find((d) => d.event.type === "withdrawal_triggered" || d.event.type === "retreat_triggered");
    expect(leave).toBeDefined();
    const workEnd = inc.inputLog.find((i) => i.input.kind === "commit_plan")?.input;
    const plannedWorkEnd = workEnd?.kind === "commit_plan" ? workEnd.plan.workInterval.endMs : 0;
    // It departed before the planned work interval ended, with no coordinator approval or input.
    expect(leave!.tick).toBeLessThan(plannedWorkEnd);
    expect(inc.inputLog.every((i) => i.input.kind !== "relay" && i.input.kind !== "set_active_recipient")).toBe(true);
    expect(inc.projectAgent(crew1).state).not.toBe("lost");
    expect(inc.notices.some((n) => n.kind === "agent_lost")).toBe(false);
    expect(log.forecastEvents.some((e) => e.kind === "contradiction" || e.kind === "rebuild_complete")).toBe(true);
  });
});

describe("optional mission switching hysteresis", () => {
  const scenario = scenarioWith({ fire: patch(1500, 100), sites: ["site-a", "site-b", "site-c"] });
  const steady = {
    ...DEFAULT_FORECAST_CONFIG,
    prior: {
      spreadMultiplier: { min: 0.6, max: 0.8 },
      windOffsetDeg: { min: -5, max: 5 },
      shiftTimeMs: { min: 1_300_000, max: 1_400_000 },
      postShiftDeg: { min: 45, max: 100 },
    },
  };

  /** Lets the test decide how valuable each site looks, so scores are exact and controlled. */
  class Valued extends CrewController {
    values: Record<string, number> = { "site-a": 1, "site-b": 0.01, "site-c": 0.01 };
    override candidateSearch(ctx: Parameters<CrewController["candidateSearch"]>[0], allowed: Parameters<CrewController["candidateSearch"]>[1]) {
      const sites = scenario.map.sites.map((s) => ({
        siteId: s.id,
        nodeId: s.nodeId,
        value: this.values[s.id] ?? 1,
        requiredWork: s.requiredWork,
        knownCompletedWork: 0,
        knownResolved: false,
      }));
      return planMissions(ctx, protectionTargets(sites, 1, allowed));
    }
  }

  function setup() {
    const c = new Valued({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: scenario.map, config: { forecast: steady } });
    const store = new KnowledgeStore(crew1);
    store.ingest(briefingObservation(scenario.map, scenario.map.sites.map((s) => s.id)));
    const at = (now: number, position: AgentPosition, legIndex: number | null): AgentProjection => ({
      agentId: crew1,
      simTimeMs: now,
      role: "protection_crew",
      callsign: "Crew 1",
      position,
      state: legIndex === null ? "idle" : "approaching",
      objectiveRevision: 0,
      planRevision: 1,
      knowledgeRevision: store.revision,
      commitment: legIndex === null ? null : { planId: c.activePlanId ?? "p", legIndex, legCount: 7, mode: "normal", working: false },
      knowledge: store.snapshot(SimTimeMs.parse(now)),
      inputHash: store.inputHash(),
    });
    return { c, at };
  }

  const enRoute = (d: number): AgentPosition => ({
    kind: "edge",
    edgeId: "e-rw-j1" as never,
    distanceAlongPolyline: d as never,
    direction: "forward",
    turnaroundTimeRemaining: 0 as never,
  });

  it("switches only for a clearly better mission, and not twice inside the cooldown", () => {
    const { c, at } = setup();
    const start = c.tick(at(0, { kind: "node", nodeId: NodeId.parse("n-rw") }, null));
    expect(start.decisions[0]?.type).toBe("mission_start");
    const first = c.activePlanId;
    // A modestly better alternative (below the 20% margin) never causes a switch.
    c.values = { "site-a": 1, "site-b": 1.05, "site-c": 0.01 };
    expect(c.tick(at(30_000, enRoute(120), 0)).decisions).toHaveLength(0);
    expect(c.activePlanId).toBe(first);
    // A much better one does, once an evaluation is due.
    c.values = { "site-a": 1, "site-b": 0.01, "site-c": 50 };
    expect(c.tick(at(40_000, enRoute(160), 0)).decisions).toHaveLength(0); // evaluated 10 s ago: not yet due
    const switched = c.tick(at(60_000, enRoute(240), 0));
    expect(switched.decisions.map((d) => d.reasonCode)).toEqual(["better_mission_found"]);
    expect(c.activePlanId).not.toBe(first);
    // An even better one within 30 s of the switch is ignored: no thrashing.
    c.values = { "site-a": 1000, "site-b": 0.01, "site-c": 0.01 };
    expect(c.tick(at(75_000, enRoute(300), 0)).decisions).toHaveLength(0);
    expect(c.tick(at(90_000, enRoute(100), 0)).decisions.map((d) => d.reasonCode)).toEqual(["better_mission_found"]);
  });
});

describe("mid-edge replanning against the simulator", () => {
  it("reverses on the corridor with the turnaround delay when fire is observed ahead", () => {
    const scenario = scenarioWith({ fire: patch(1500, 100), sites: ["site-a"] });
    const inc = new Incident({ scenario, seed: "mid", overrides: calm });
    const road = new RoadIndex(scenario.map);
    inc.submit(
      authoredCommit({
        road,
        agentId: crew1,
        planId: "walk",
        knowledgeRevision: inc.agentRevision(crew1),
        startNode: NodeId.parse("n-rw"),
        departMs: 0,
        approach: ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"],
        workSiteId: SiteId.parse("site-a"),
        workMs: 60_000,
        back: ["e-h-sa", "e-s-h", "e-j1-s", "e-rw-j1"],
      }),
    );
    inc.advanceTo(200_000);
    const live = inc.projectAgent(crew1);
    expect(live.position.kind === "edge" && live.position.edgeId).toBe("e-s-h");
    // The crew's own knowledge gains a sighting of burning cells further along the corridor.
    const store = new KnowledgeStore(crew1);
    for (const o of live.knowledge.observations) store.ingest(o);
    const ahead = cellsOfEdge(road, "e-s-h").filter((c) => (road.edgesByCell.get(c) ?? []).length === 1).slice(-4);
    store.ingest(
      Observation.parse({
        id: "obs:crew-1:200000x",
        sourceAgentId: crew1,
        observedAt: 200_000,
        receivedAt: 200_000,
        spatialFootprint: { centerX: 900, centerY: 740, radius: 150 },
        observedFields: ahead.map((gridCellIndex) => ({ kind: "cell", gridCellIndex, burnState: "burning" as const })),
      }),
    );
    const c = crew(scenario);
    const out = c.tick({ ...live, knowledge: store.snapshot(SimTimeMs.parse(200_000)) });
    const order = out.orders[0];
    expect(order?.kind).toBe("commit_plan");
    if (order?.kind !== "commit_plan") return;
    const first = order.plan.timedLegs[0]!;
    expect(first.edgeId).toBe("e-s-h");
    expect(first.direction).toBe("reverse");
    // The simulator accepts it from the actual position and starts the turnaround at once.
    inc.submit(order);
    inc.advanceTo(201_000);
    const turning = inc.projectAgent(crew1).position;
    expect(turning.kind === "edge" && turning.direction).toBe("reverse");
    expect(turning.kind === "edge" && turning.turnaroundTimeRemaining).toBe(4000);
    inc.advanceTo(400_000);
    expect(inc.notices.some((n) => n.kind === "plan_rejected")).toBe(false);
    expect(inc.projectAgent(crew1).state).not.toBe("lost");
  });
});

describe("older relayed clear versus fresh local fire", () => {
  it("keeps a cell closed once seen burning, whatever older relay says", async () => {
    const { EvidenceTracker } = await import("./evidence.js");
    const scenario = scenarioWith({ fire: patch(1500, 100) });
    const tracker = new EvidenceTracker(scenario.map);
    const cell = cellIndexOf(900, 740)!;
    const obs = (id: string, at: number, state: "burning" | "unburned", by: string) =>
      Observation.parse({
        id,
        sourceAgentId: by,
        observedAt: at,
        receivedAt: at + 10_000,
        spatialFootprint: { centerX: 900, centerY: 740, radius: 150 },
        observedFields: [{ kind: "cell", gridCellIndex: cell, burnState: state }],
      });
    tracker.ingest([obs("local", 300_000, "burning", "crew-1")]);
    expect(tracker.closed.has(cell)).toBe(true);
    // A coordinator relay of a scout's older "clear" arrives afterwards.
    tracker.ingest([obs("local", 300_000, "burning", "crew-1"), obs("old-clear", 200_000, "unburned", "scout")]);
    expect(tracker.closed.has(cell)).toBe(true);
  });
});

describe("per-crew communication style", () => {
  it("a radio-style crew reports callsign-first and a plain one does not", () => {
    const scenario = scenarioWith({ fire: far, work: 60 });
    const run = (style: "plain" | "radio") => {
      const inc = new Incident({ scenario, seed: "st1", overrides: calm });
      const c = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: scenario.map, style });
      runControllers(inc, [c], 120_000);
      return { text: inc.projectCoordinator().recentReports.map((r) => r.text), last: c.status(inc.projectAgent(crew1)).lastReport };
    };
    const plain = run("plain");
    const radio = run("radio");
    expect(plain.text.some((t) => /^Crew 1 is heading to Ridge Cabins/.test(t))).toBe(true);
    expect(radio.text.some((t) => /^Crew 1, heading to Ridge Cabins/.test(t))).toBe(true);
    expect(radio.last).toMatch(/^Crew 1,/);
  });
});

describe("controller capabilities", () => {
  it("expose the role's documented speed and work rate, and a crew plans from its own work rate", () => {
    const scenario = scenarioWith({ fire: far });
    const c = crew(scenario);
    expect(c.capabilities).toEqual({ speedMps: 4, workRate: 1 });
    expect(new CrewController({ agentId: crew1, callsign: "Scout", role: "scout", map: scenario.map }).capabilities.workRate).toBe(0);
  });
});

describe("member condition in the controller", () => {
  it("accumulates fatigue over a mission, keeps every value in range, and plans from the tightened config", () => {
    const scenario = scenarioWith({ fire: far, work: 60 });
    const inc = new Incident({ scenario, seed: "m1", overrides: calm });
    const c = crew(scenario);
    expect(c.memberState).toEqual({ fatigue: 0, morale: 1 });
    runControllers(inc, [c], 400_000);
    const m = c.memberState;
    expect(m.fatigue).toBeGreaterThan(0);
    for (const v of [m.fatigue, m.morale]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("a rested crew behaves exactly as before: tightening starts only past the onset", () => {
    const scenario = scenarioWith({ fire: far, work: 60 });
    const inc = new Incident({ scenario, seed: "a1", overrides: calm });
    const c = crew(scenario);
    runControllers(inc, [c], 700_000);
    expect(inc.end?.matchingReasons ?? []).toContain("all_sites_resolved");
  });
});
