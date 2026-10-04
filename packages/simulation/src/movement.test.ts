import { describe, expect, it } from "vitest";
import { AgentId, MissionPlan, MissionPlanId, NodeId, SequenceNumber, SimTimeMs } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario, dueSimTimeMs, realPlayExpired, wallMsForSimTime } from "./index.js";
import { RoadIndex, cellIndexOf } from "./model/index.js";

const calm = { spreadMultiplier: 0.01, windShiftMs: 10_000_000, initialWindRad: 0 };

function twoAtCorridor() {
  const base = buildSyntheticScenario({ agents: ["crew-1", "crew-2"], sites: ["site-a"] });
  const [a, b] = base.agents;
  return {
    ...base,
    agents: [
      { ...a!, startNodeId: NodeId.parse("n-s") },
      { ...b!, startNodeId: NodeId.parse("n-h") },
    ],
    map: { ...base.map, initialFireCells: [cellIndexOf(30, 1500)!] },
  };
}

function walk(inc: Incident, id: string, start: string, edges: string[], departMs = 0) {
  return authoredCommit({
    road: new RoadIndex(inc.scenario.map),
    agentId: AgentId.parse(id),
    planId: `${id}-${departMs}-${edges.join("+")}`,
    knowledgeRevision: inc.agentRevision(AgentId.parse(id)),
    startNode: NodeId.parse(start),
    departMs,
    approach: edges,
    workSiteId: null,
    workMs: 0,
    back: [],
  });
}

describe("clock mapping", () => {
  it("maps real play time to incident time at 5 simulated seconds per real second", () => {
    expect(dueSimTimeMs(0)).toBe(0);
    expect(dueSimTimeMs(200)).toBe(1000);
    expect(dueSimTimeMs(199)).toBe(0);
    expect(dueSimTimeMs(60_000)).toBe(300_000);
    expect(dueSimTimeMs(300_000)).toBe(1_500_000);
  });

  it("caps at the incident horizon and ignores time past the five-minute limit", () => {
    expect(dueSimTimeMs(10_000_000)).toBe(1_500_000);
    expect(dueSimTimeMs(-5)).toBe(0);
    expect(realPlayExpired(299_999)).toBe(false);
    expect(realPlayExpired(300_000)).toBe(true);
    expect(wallMsForSimTime(1_500_000)).toBe(300_000);
  });
});

describe("movement rules", () => {
  it("rejects off-road legs until the simulator implements them", () => {
    const inc = new Incident({ scenario: twoAtCorridor(), seed: "m", overrides: calm });
    const plan = MissionPlan.parse({
      id: "offroad", recipientId: "crew-1", knowledgeRevision: inc.agentRevision(AgentId.parse("crew-1")),
      timedLegs: [],
      offroadLegs: [{ kind: "offroad", start: { x: 400, y: 800 }, end: { x: 500, y: 900 }, departMs: 0, arriveMs: 70_000 }],
      workInterval: { startMs: 70_000, endMs: 70_000 }, refugeId: "n-rw", reservationRevision: 0, limitingReason: null,
    });
    inc.submit({ kind: "commit_plan", agentId: AgentId.parse("crew-1"), plan, workSiteId: null, mode: "normal" });
    inc.advanceTo(1000);
    expect(inc.notices).toContainEqual(expect.objectContaining({ kind: "plan_rejected", reason: "offroad_movement_not_supported" }));
  });

  it("waits at a node until the leg's planned departure time", () => {
    const inc = new Incident({ scenario: twoAtCorridor(), seed: "m", overrides: calm });
    inc.submit(walk(inc, "crew-1", "n-s", ["e-s-h"], 20_000));
    inc.advanceTo(19_000);
    expect(inc.projectAgent(AgentId.parse("crew-1")).position.kind).toBe("node");
    inc.advanceTo(25_000);
    const pos = inc.projectAgent(AgentId.parse("crew-1")).position;
    expect(pos.kind).toBe("edge");
    if (pos.kind === "edge") expect(pos.distanceAlongPolyline).toBeCloseTo(20, 6);
  });

  it("never lets two agents occupy the single-capacity segment together", () => {
    const inc = new Incident({ scenario: twoAtCorridor(), seed: "m", overrides: calm });
    inc.submit(walk(inc, "crew-1", "n-s", ["e-s-h"]));
    inc.submit(walk(inc, "crew-2", "n-h", ["e-s-h"]));
    for (let t = 1000; t <= 300_000; t += 1000) {
      inc.advanceTo(t);
      const onEdge = inc
        .truth()
        .agents.filter((a) => a.position.kind === "edge" && a.position.edgeId === "e-s-h");
      expect(onEdge.length).toBeLessThanOrEqual(1);
    }
    expect(inc.notices.some((n) => n.kind === "entry_blocked" && n.agentId === "crew-2")).toBe(true);
    // The blocked crew waits at its node and crosses after the first one clears.
    expect(inc.projectAgent(AgentId.parse("crew-2")).position).toEqual({ kind: "node", nodeId: "n-s" });
    expect(inc.projectAgent(AgentId.parse("crew-1")).position).toEqual({ kind: "node", nodeId: "n-h" });
  });

  it("reverses mid-edge with a 5 second turnaround that keeps edge occupancy", () => {
    const inc = new Incident({ scenario: twoAtCorridor(), seed: "m", overrides: calm });
    inc.submit(walk(inc, "crew-1", "n-s", ["e-s-h"]));
    inc.advanceTo(30_000);
    const back = MissionPlan.parse({
      id: MissionPlanId.parse("reverse"),
      recipientId: AgentId.parse("crew-1"),
      knowledgeRevision: SequenceNumber.parse(inc.agentRevision(AgentId.parse("crew-1"))),
      timedLegs: [{ edgeId: "e-s-h", direction: "reverse", departMs: SimTimeMs.parse(30_000), arriveMs: SimTimeMs.parse(65_000) }],
      workInterval: { startMs: 65_000, endMs: 65_000 },
      refugeId: NodeId.parse("n-s"),
      reservationRevision: 0,
      limitingReason: null,
    });
    inc.submit({ kind: "commit_plan", agentId: AgentId.parse("crew-1"), plan: back, workSiteId: null, mode: "withdrawing" });
    inc.advanceTo(31_000);
    let pos = inc.projectAgent(AgentId.parse("crew-1")).position;
    expect(pos.kind === "edge" && pos.direction).toBe("reverse");
    expect(pos.kind === "edge" && pos.turnaroundTimeRemaining).toBe(4000);
    expect(inc.projectAgent(AgentId.parse("crew-1")).state).toBe("withdrawing");
    inc.advanceTo(35_000);
    pos = inc.projectAgent(AgentId.parse("crew-1")).position;
    // Turnaround holds position for 5 steps; no distance is gained meanwhile.
    expect(pos.kind === "edge" && pos.distanceAlongPolyline).toBeCloseTo(120, 6);
    inc.advanceTo(200_000);
    expect(inc.projectAgent(AgentId.parse("crew-1")).position).toEqual({ kind: "node", nodeId: "n-s" });
  });

  it("rejects a plan whose legs do not connect to the agent's position", () => {
    const inc = new Incident({ scenario: twoAtCorridor(), seed: "m", overrides: calm });
    inc.submit(walk(inc, "crew-1", "n-h", ["e-s-h"]));
    inc.advanceTo(1000);
    expect(inc.notices.some((n) => n.kind === "plan_rejected" && n.reason === "leg_not_connected")).toBe(true);
    expect(inc.projectAgent(AgentId.parse("crew-1")).commitment).toBeNull();
  });
});
