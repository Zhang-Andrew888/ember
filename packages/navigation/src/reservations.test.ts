import { describe, expect, it } from "vitest";
import { AgentId, EdgeId, MissionPlan, MissionPlanId, NodeId, SimTimeMs } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { ReservationService, type YieldHandler } from "./reservations.js";

const road = new RoadIndex(buildSyntheticScenario().map);
const a = AgentId.parse("crew-1");
const b = AgentId.parse("crew-2");
const c = AgentId.parse("crew-3");

function corridorPlan(agent: AgentId, id: string, enterMs: number, direction: "forward" | "reverse" = "forward", travelMs = 95_000): MissionPlan {
  return MissionPlan.parse({
    id: MissionPlanId.parse(id),
    recipientId: agent,
    knowledgeRevision: 0,
    timedLegs: [
      { edgeId: EdgeId.parse("e-s-h"), direction, departMs: SimTimeMs.parse(enterMs), arriveMs: SimTimeMs.parse(enterMs + travelMs) },
    ],
    workInterval: { startMs: SimTimeMs.parse(enterMs + travelMs), endMs: SimTimeMs.parse(enterMs + travelMs) },
    refugeId: NodeId.parse("n-rs"),
    reservationRevision: 0,
    limitingReason: null,
  });
}

const edge = EdgeId.parse("e-s-h");

describe("reservations on the single-capacity segment", () => {
  it("blocks any overlapping window in either direction, including the guard gap", () => {
    const svc = new ReservationService(road);
    expect(svc.reserve(a, corridorPlan(a, "pa", 100_000), "approach", 0).ok).toBe(true);
    const oracle = svc.oracleFor(b);
    // a holds [100 s, 195 s]; the 5 s guard keeps others out until 200 s.
    expect(oracle.isFree(edge, "reverse", 150_000, 245_000)).toBe(false);
    expect(oracle.isFree(edge, "forward", 196_000, 291_000)).toBe(false);
    expect(oracle.isFree(edge, "forward", 200_000, 295_000)).toBe(true);
    expect(oracle.isFree(edge, "reverse", 0, 95_000)).toBe(true);
    expect(oracle.isFree(edge, "reverse", 5_000, 100_000)).toBe(false);
    expect(oracle.isFree(edge, "reverse", 0, 90_000)).toBe(true);
    // The holder never blocks itself.
    expect(svc.oracleFor(a).isFree(edge, "forward", 100_000, 195_000)).toBe(true);
    // Non-constrained edges are never gated.
    expect(oracle.isFree(EdgeId.parse("e-j1-s"), "forward", 100_000, 195_000)).toBe(true);
  });

  it("denies an overlapping request from an equal-class agent that entered later", () => {
    const svc = new ReservationService(road);
    expect(svc.reserve(a, corridorPlan(a, "pa", 100_000), "approach", 0).ok).toBe(true);
    const r = svc.reserve(b, corridorPlan(b, "pb", 120_000, "reverse"), "approach", 0);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("conflict");
    expect(svc.holdings(b)).toBeNull();
    expect(svc.holdings(a)).not.toBeNull();
  });

  it("breaks equal-class ties by earlier requested entry, then stable agent id", () => {
    expect(ReservationService.outranks({ cls: "approach", enterMs: 100, agentId: a }, { cls: "approach", enterMs: 200, agentId: b })).toBe(true);
    expect(ReservationService.outranks({ cls: "approach", enterMs: 200, agentId: a }, { cls: "approach", enterMs: 100, agentId: b })).toBe(false);
    expect(ReservationService.outranks({ cls: "approach", enterMs: 100, agentId: a }, { cls: "approach", enterMs: 100, agentId: b })).toBe(true);
    expect(ReservationService.outranks({ cls: "emergency", enterMs: 900, agentId: c }, { cls: "return", enterMs: 1, agentId: a })).toBe(true);
    expect(ReservationService.outranks({ cls: "return", enterMs: 900, agentId: c }, { cls: "approach", enterMs: 1, agentId: a })).toBe(true);
    expect(ReservationService.outranks({ cls: "approach", enterMs: 900, agentId: c }, { cls: "scout", enterMs: 1, agentId: a })).toBe(true);
  });

  it("moves a future reservation only after its holder verifies a safe yield", () => {
    const svc = new ReservationService(road);
    svc.reserve(a, corridorPlan(a, "pa", 100_000), "approach", 0);
    const asked: AgentId[] = [];
    const handler: YieldHandler = (holder, blocked) => {
      asked.push(holder);
      expect(blocked[0]?.edgeId).toBe("e-s-h");
      return corridorPlan(holder, "pa-revised", 300_000);
    };
    svc.setYieldHandler(handler);
    const r = svc.reserve(b, corridorPlan(b, "pb", 110_000, "reverse"), "emergency", 20_000);
    expect(r.ok).toBe(true);
    expect(asked).toEqual([a]);
    expect(r.ok && r.yielded.map((y) => y.agentId)).toEqual([a]);
    expect(svc.holdings(a)?.planId).toBe("pa-revised");
    expect(svc.holdings(b)?.planId).toBe("pb");
    // The two schedules no longer overlap.
    expect(svc.oracleFor(c).isFree(edge, "forward", 210_000, 290_000)).toBe(true);
  });

  it("rejects an unsafe yield: nothing moves and the requester gets no slot", () => {
    const svc = new ReservationService(road);
    svc.reserve(a, corridorPlan(a, "pa", 100_000), "approach", 0);
    svc.setYieldHandler(() => null);
    const r = svc.reserve(b, corridorPlan(b, "pb", 110_000, "reverse"), "emergency", 20_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("no_safe_yield");
    expect(svc.holdings(a)?.planId).toBe("pa");
    expect(svc.holdings(b)).toBeNull();
    // The conflict is reported, not papered over with an invented schedule.
    expect(!r.ok && r.conflicts.map((x) => x.agentId)).toEqual([a]);
  });

  it("never preempts a physical occupant, whatever the priority", () => {
    const svc = new ReservationService(road);
    svc.updateOccupancy(a, { edgeId: edge, expectedExitMs: 150_000 });
    svc.setYieldHandler(() => corridorPlan(a, "x", 400_000));
    const early = svc.reserve(b, corridorPlan(b, "pb", 120_000), "emergency", 100_000);
    expect(early.ok).toBe(false);
    expect(!early.ok && early.reason).toBe("physically_occupied");
    const late = svc.reserve(b, corridorPlan(b, "pb2", 155_000), "emergency", 100_000);
    expect(late.ok).toBe(true);
    expect(svc.oracleFor(c).isFree(edge, "forward", 120_000, 140_000)).toBe(false);
  });

  it("treats a holder whose window has already begun as occupying, not as movable", () => {
    const svc = new ReservationService(road);
    svc.reserve(a, corridorPlan(a, "pa", 100_000), "approach", 0);
    svc.setYieldHandler(() => corridorPlan(a, "x", 400_000));
    const r = svc.reserve(b, corridorPlan(b, "pb", 110_000, "reverse"), "emergency", 105_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("physically_occupied");
  });

  it("replaces an agent's earlier reservations atomically and releases them", () => {
    const svc = new ReservationService(road);
    svc.reserve(a, corridorPlan(a, "p1", 100_000), "approach", 0);
    const rev = svc.revision;
    svc.reserve(a, corridorPlan(a, "p2", 400_000), "approach", 0);
    expect(svc.revision).toBeGreaterThan(rev);
    expect(svc.oracleFor(b).isFree(edge, "forward", 100_000, 195_000)).toBe(true);
    expect(svc.oracleFor(b).isFree(edge, "forward", 400_000, 495_000)).toBe(false);
    svc.release(a);
    expect(svc.oracleFor(b).isFree(edge, "forward", 400_000, 495_000)).toBe(true);
  });

  it("flags future reservations invalidated when a reversal extends physical occupancy", () => {
    const svc = new ReservationService(road);
    svc.updateOccupancy(a, { edgeId: edge, expectedExitMs: 150_000 });
    svc.reserve(b, corridorPlan(b, "pb", 160_000), "approach", 100_000);
    expect(svc.stillValid(b, 100_000)).toBe(true);
    // a turns around mid-edge: it now leaves much later, so b's slot is no longer safe.
    svc.updateOccupancy(a, { edgeId: edge, expectedExitMs: 230_000 });
    expect(svc.stillValid(b, 100_000)).toBe(false);
    expect(svc.stillValid(a, 100_000)).toBe(true);
  });

  it("ignores lower-class holders when a higher-class agent plans, so it can ask them to yield", () => {
    const svc = new ReservationService(road);
    svc.reserve(a, corridorPlan(a, "pa", 100_000), "scout", 0);
    expect(svc.oracleFor(b, "emergency").isFree(edge, "reverse", 110_000, 205_000)).toBe(true);
    expect(svc.oracleFor(b, "scout").isFree(edge, "reverse", 110_000, 205_000)).toBe(false);
    expect(svc.oracleFor(b, "approach").isFree(edge, "reverse", 110_000, 205_000)).toBe(true);
  });
});
