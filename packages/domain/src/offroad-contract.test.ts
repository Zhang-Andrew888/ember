import { describe, expect, it } from "vitest";
import { AgentPosition, CoordinatorAgentPlanView, MissionPlan, OffroadTimedLeg } from "./index.js";

const start = { x: 400, y: 800 };
const end = { x: 500, y: 900 };

describe("off-road movement contract", () => {
  it("round-trips bounded position and progress", () => {
    const position = AgentPosition.parse({ kind: "offroad", start, end, progress: 0.4 });
    expect(position).toEqual({ kind: "offroad", start, end, progress: 0.4 });
    expect(AgentPosition.parse(JSON.parse(JSON.stringify(position)))).toEqual(position);
  });

  it("round-trips a half-speed leg through mission and coordinator views", () => {
    const leg = OffroadTimedLeg.parse({ kind: "offroad", start, end, departMs: 10_000, arriveMs: 80_000 });
    expect(leg.speedFactor).toBe(0.5);
    const plan = MissionPlan.parse({
      id: "plan-offroad", recipientId: "crew-1", knowledgeRevision: 1,
      timedLegs: [], offroadLegs: [leg],
      workInterval: { startMs: 80_000, endMs: 80_000 }, refugeId: "n-rw",
      reservationRevision: 0, limitingReason: null,
    });
    expect(MissionPlan.parse(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    const view = CoordinatorAgentPlanView.parse({
      agentId: "crew-1", planId: plan.id, legs: [], offroadLegs: [leg],
      workInterval: plan.workInterval, refugeId: plan.refugeId,
      phase: "approach", limitingReason: null,
    });
    expect(view.offroadLegs?.[0]?.speedFactor).toBe(0.5);
  });

  it("rejects coordinates outside the map and invalid progress or timing", () => {
    expect(AgentPosition.safeParse({ kind: "offroad", start: { x: -1, y: 0 }, end, progress: 0.5 }).success).toBe(false);
    expect(AgentPosition.safeParse({ kind: "offroad", start, end: { x: 1601, y: 0 }, progress: 0.5 }).success).toBe(false);
    expect(AgentPosition.safeParse({ kind: "offroad", start, end, progress: 1.1 }).success).toBe(false);
    expect(OffroadTimedLeg.safeParse({ kind: "offroad", start, end, departMs: 80_000, arriveMs: 10_000 }).success).toBe(false);
    expect(OffroadTimedLeg.safeParse({ kind: "offroad", start, end: start, departMs: 0, arriveMs: 10_000 }).success).toBe(false);
  });
});
