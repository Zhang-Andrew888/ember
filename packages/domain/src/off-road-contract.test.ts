import { describe, expect, it } from "vitest";
import { AgentPosition, MissionPlan, OffRoadTimedLeg, RoadTimedLeg, TimedLeg } from "./index.js";

describe("off-road movement contract (#119/#120)", () => {
  it("parses legacy road legs without kind", () => {
    const leg = TimedLeg.parse({
      edgeId: "e-a-b",
      direction: "forward",
      departMs: 0,
      arriveMs: 5000,
    });
    expect(leg).toEqual({
      kind: "road",
      edgeId: "e-a-b",
      direction: "forward",
      departMs: 0,
      arriveMs: 5000,
    });
  });

  it("parses an off-road leg with map coordinates and end node", () => {
    const leg = OffRoadTimedLeg.parse({
      kind: "off_road",
      fromX: 100,
      fromY: 200,
      toX: 160,
      toY: 280,
      endNodeId: "n-hub",
      departMs: 10_000,
      arriveMs: 30_000,
    });
    expect(leg.kind).toBe("off_road");
    expect(RoadTimedLeg.safeParse(leg).success).toBe(false);
  });

  it("AgentPosition includes off_road for coordinator projection", () => {
    const pos = AgentPosition.parse({ kind: "off_road", x: 50, y: 60, headingRad: 1.57 });
    expect(pos.kind).toBe("off_road");
  });

  it("MissionPlan accepts mixed road and off-road legs", () => {
    const plan = MissionPlan.parse({
      id: "plan-mix",
      recipientId: "crew-1",
      knowledgeRevision: 1,
      timedLegs: [
        { kind: "off_road", fromX: 0, fromY: 0, toX: 40, toY: 0, endNodeId: "n-a", departMs: 0, arriveMs: 10_000 },
        { edgeId: "e-a-b", direction: "forward", departMs: 10_000, arriveMs: 20_000 },
      ],
      workInterval: { startMs: 20_000, endMs: 20_000 },
      refugeId: "n-ref",
      reservationRevision: 0,
      limitingReason: null,
    });
    expect(plan.timedLegs).toHaveLength(2);
    expect(plan.timedLegs[0]?.kind).toBe("off_road");
    expect(plan.timedLegs[1]?.kind).toBe("road");
  });
});
