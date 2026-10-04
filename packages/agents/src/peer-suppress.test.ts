import { describe, expect, it } from "vitest";
import { AgentId, MissionPlan, MissionPlanId, NodeId, SequenceNumber, SimTimeMs } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, cellCenter, cellIndexOf } from "@ember/simulation/model";
import { planStandoffPoint } from "./peer-suppress.js";

const road = new RoadIndex(buildSyntheticScenario({ gameChanges: true }).map);

function offroadSuppressPlan(start: { x: number; y: number }, end: { x: number; y: number }, cell: number): MissionPlan {
  return MissionPlan.parse({
    id: MissionPlanId.parse("p"),
    recipientId: AgentId.parse("crew-1"),
    knowledgeRevision: SequenceNumber.parse(0),
    timedLegs: [],
    offroadLegs: [{ kind: "offroad", start, end, departMs: SimTimeMs.parse(0), arriveMs: SimTimeMs.parse(60_000) }],
    workInterval: { startMs: SimTimeMs.parse(60_000), endMs: SimTimeMs.parse(120_000) },
    work: { kind: "suppress_fire", gridCellIndex: cell },
    refugeId: NodeId.parse("n-rw"),
    reservationRevision: SequenceNumber.parse(0),
    limitingReason: null,
  });
}

describe("planned standoff point", () => {
  const cell = cellIndexOf(800, 600)!;
  const c = cellCenter(cell);

  it("is where the approach ends when that is short of the fire", () => {
    const end = { x: c.x - 100, y: c.y };
    expect(planStandoffPoint(road, offroadSuppressPlan({ x: c.x - 300, y: c.y }, end, cell))).toEqual(end);
  });

  it("falls back to the approach side when the drive is planned onto the burning cell", () => {
    const start = { x: c.x - 300, y: c.y };
    expect(planStandoffPoint(road, offroadSuppressPlan(start, { x: c.x, y: c.y }, cell))).toEqual(start);
  });
});
