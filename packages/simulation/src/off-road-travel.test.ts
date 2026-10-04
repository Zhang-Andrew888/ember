import { describe, expect, it } from "vitest";
import { AgentId, MissionPlan, MissionPlanId, NodeId, SequenceNumber, SimTimeMs, type EdgeId } from "@ember/domain";
import {
  Incident,
  authoredCommit,
  buildSyntheticScenario,
  legTravelMs,
} from "./index.js";
import { RoadIndex, SIM_DEFAULTS, cellIndexOf } from "./model/index.js";

const noWindShift = { windShiftMs: 10_000_000, spreadMultiplier: 1, initialWindRad: 0 };

function farFireScenario() {
  return buildSyntheticScenario({ agents: ["crew-3"], sites: [] });
}

function offRoadTravelMs(distanceM: number): number {
  const speed = SIM_DEFAULTS.agentSpeedMps * SIM_DEFAULTS.offRoadSpeedFactor;
  const exact = (distanceM / speed) * 1000;
  return Math.ceil(exact / 5000) * 5000;
}

describe("off-road travel (#120, #137 contract)", () => {
  it("rejects a plan whose first leg references an unknown road edge", () => {
    const scenario = farFireScenario();
    const inc = new Incident({
      scenario: { ...scenario, map: { ...scenario.map, initialFireCells: [cellIndexOf(30, 1500)!] } },
      seed: "or-reject",
      overrides: noWindShift,
    });
    const crew = AgentId.parse("crew-3");
    const plan = MissionPlan.parse({
      id: MissionPlanId.parse("bad-edge"),
      recipientId: crew,
      knowledgeRevision: SequenceNumber.parse(inc.agentRevision(crew)),
      timedLegs: [
        {
          edgeId: "e-not-real" as EdgeId,
          direction: "forward",
          departMs: SimTimeMs.parse(0),
          arriveMs: SimTimeMs.parse(5000),
        },
      ],
      workInterval: { startMs: SimTimeMs.parse(5000), endMs: SimTimeMs.parse(5000) },
      refugeId: NodeId.parse("n-rs"),
      reservationRevision: 0,
      limitingReason: null,
    });
    inc.submit({ kind: "commit_plan", agentId: crew, plan, workSiteId: null, mode: "normal" });
    inc.advanceTo(SIM_DEFAULTS.stepMs);
    expect(inc.notices.some((n) => n.kind === "plan_rejected" && n.reason === "unknown_edge")).toBe(true);
  });

  it("traverses an offroadLeg, projects offroad progress, and finishes on a road node", () => {
    const scenario = farFireScenario();
    const inc = new Incident({
      scenario: { ...scenario, map: { ...scenario.map, initialFireCells: [cellIndexOf(30, 1500)!] } },
      seed: "or-move",
      overrides: noWindShift,
    });
    const crew = AgentId.parse("crew-3");
    const road = new RoadIndex(scenario.map);
    inc.submit(
      authoredCommit({
        road,
        agentId: crew,
        planId: "to-n-s",
        knowledgeRevision: inc.agentRevision(crew),
        startNode: NodeId.parse("n-rs"),
        departMs: 0,
        approach: ["e-rs-s"],
        workSiteId: null,
        workMs: 0,
        back: [],
      }),
    );
    const rsEdge = road.mustEdge("e-rs-s" as EdgeId);
    inc.advanceTo(legTravelMs(rsEdge.length));
    expect(inc.projectAgent(crew).position).toEqual({ kind: "node", nodeId: "n-s" });

    const start = { x: 700, y: 600 };
    const end = { x: 1000, y: 800 };
    const travelMs = offRoadTravelMs(Math.hypot(end.x - start.x, end.y - start.y));
    const offPlan = MissionPlan.parse({
      id: MissionPlanId.parse("off-s-h"),
      recipientId: crew,
      knowledgeRevision: SequenceNumber.parse(inc.agentRevision(crew)),
      timedLegs: [],
      offroadLegs: [
        {
          kind: "offroad",
          start,
          end,
          departMs: SimTimeMs.parse(0),
          arriveMs: SimTimeMs.parse(travelMs),
        },
      ],
      workInterval: { startMs: SimTimeMs.parse(travelMs), endMs: SimTimeMs.parse(travelMs) },
      refugeId: NodeId.parse("n-rs"),
      reservationRevision: 0,
      limitingReason: null,
    });
    inc.submit({ kind: "commit_plan", agentId: crew, plan: offPlan, workSiteId: null, mode: "normal" });
    expect(inc.notices.some((n) => n.kind === "plan_rejected")).toBe(false);

    inc.advanceTo(inc.truth().timeMs + 1);
    const mid = inc.projectAgent(crew).position;
    expect(mid.kind === "offroad" || mid.kind === "node").toBe(true);
    if (mid.kind === "offroad") {
      expect(mid.progress).toBeGreaterThan(0);
    }

    inc.advanceTo(inc.truth().timeMs + travelMs + 5000);
    expect(inc.projectAgent(crew).position).toEqual({ kind: "node", nodeId: "n-h" });
    expect(inc.notices.some((n) => n.kind === "plan_complete")).toBe(true);
  });
});
