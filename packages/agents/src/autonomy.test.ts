import { describe, expect, it } from "vitest";
import { FRESH_MEMBER_STATE, type MemberState } from "./member-state.js";
import {
  AUTONOMY_THRESHOLDS,
  decideContinuation,
  decideOrder,
  type ContinuationInput,
  type OrderInput,
} from "./autonomy.js";

const fresh = FRESH_MEMBER_STATE;
const order = (over: Partial<OrderInput> = {}): OrderInput => ({
  kind: "protect_site",
  member: fresh,
  forecastReliable: true,
  feasible: true,
  limitingReason: null,
  ...over,
});
const cont = (over: Partial<ContinuationInput> = {}): ContinuationInput => ({
  member: fresh,
  phase: "work",
  mode: "normal",
  routeBlocked: false,
  certifyFailure: null,
  forecastReliable: true,
  ...over,
});
const tired = (over: Partial<MemberState>): MemberState => ({ ...fresh, ...over });

describe("when a crew refuses an order", () => {
  it("accepts a feasible protect order for a fresh crew, without chatter", () => {
    const d = decideOrder("Crew 1", order());
    expect(d).toMatchObject({ action: "accept", reason: "order_accepted", announcement: null });
  });

  it("refuses when the planner finds no mission with the required margin, keeping the planner's reason", () => {
    const d = decideOrder("Crew 1", order({ feasible: false, limitingReason: "forecast_leg_unsafe" }));
    expect(d.action).toBe("refuse");
    expect(d.reason).toBe("forecast_leg_unsafe");
    expect(d.announcement?.urgent).toBe(true);
    expect(d.announcement?.text).toMatch(/^Crew 1 /);
  });

  it("uses a default reason when the planner gives none", () => {
    expect(decideOrder("Crew 1", order({ feasible: false })).reason).toBe("no_feasible_mission_in_model");
  });

  it("refuses new protection work while the forecast is unreliable", () => {
    const d = decideOrder("Crew 1", order({ forecastReliable: false }));
    expect(d).toMatchObject({ action: "refuse", reason: "forecast_unreliable" });
  });

  it.each([
    ["fatigue", tired({ fatigue: AUTONOMY_THRESHOLDS.refuse.fatigue }), "member_fatigued"],
    ["injury risk", tired({ injuryRisk: AUTONOMY_THRESHOLDS.refuse.injuryRisk }), "member_injury_risk"],
    ["morale", tired({ morale: AUTONOMY_THRESHOLDS.refuse.morale }), "member_morale"],
  ])("refuses new work at the %s limit", (_name, member, reason) => {
    const d = decideOrder("Crew 2", order({ member }));
    expect(d).toMatchObject({ action: "refuse", reason });
    expect(d.announcement?.text).toMatch(/^Crew 2 /);
  });

  it("does not refuse just below the limits", () => {
    const member = tired({ fatigue: AUTONOMY_THRESHOLDS.refuse.fatigue - 0.01, injuryRisk: AUTONOMY_THRESHOLDS.refuse.injuryRisk - 0.01, morale: AUTONOMY_THRESHOLDS.refuse.morale + 0.01 });
    expect(decideOrder("Crew 1", order({ member })).action).toBe("accept");
  });

  it("reports the most dangerous member reason first: injury, then fatigue, then morale", () => {
    const all = tired({ fatigue: 1, injuryRisk: 1, morale: 0 });
    expect(decideOrder("Crew 1", order({ member: all })).reason).toBe("member_injury_risk");
    expect(decideOrder("Crew 1", order({ member: tired({ fatigue: 1, morale: 0 }) })).reason).toBe("member_fatigued");
  });

  it.each(["return_to_refuge", "hold", "avoid_corridor", "resume"] as const)("never refuses a safety-tightening %s order, however tired", (kind) => {
    const d = decideOrder("Crew 1", order({ kind, member: tired({ fatigue: 1, injuryRisk: 1, morale: 0 }), forecastReliable: false }));
    expect(d.action).toBe("accept");
  });

  it("refuses an unsupported order kind", () => {
    const d = decideOrder("Crew 1", order({ kind: "teleport" }));
    expect(d).toMatchObject({ action: "refuse", reason: "objective_not_supported" });
  });
});

describe("when a crew withdraws", () => {
  it("continues a healthy, certified plan silently", () => {
    expect(decideContinuation("Crew 1", cont())).toMatchObject({ action: "continue", announcement: null });
  });

  it("withdraws when a direct observation closed the route", () => {
    const d = decideContinuation("Crew 1", cont({ routeBlocked: true }));
    expect(d).toMatchObject({ action: "withdraw", reason: "route_closed_by_observation" });
    expect(d.announcement?.urgent).toBe(true);
  });

  it("withdraws when the plan no longer certifies, keeping the certifier's reason", () => {
    expect(decideContinuation("Crew 1", cont({ certifyFailure: "forecast_work_unsafe" }))).toMatchObject({ action: "withdraw", reason: "forecast_work_unsafe" });
  });

  it("withdraws when the forecast becomes unreliable", () => {
    expect(decideContinuation("Crew 1", cont({ forecastReliable: false }))).toMatchObject({ action: "withdraw", reason: "forecast_unreliable" });
  });

  it.each([
    ["fatigue", tired({ fatigue: AUTONOMY_THRESHOLDS.withdraw.fatigue }), "member_fatigued"],
    ["injury risk", tired({ injuryRisk: AUTONOMY_THRESHOLDS.withdraw.injuryRisk }), "member_injury_risk"],
    ["morale", tired({ morale: AUTONOMY_THRESHOLDS.withdraw.morale }), "member_morale"],
  ])("withdraws at the %s limit", (_n, member, reason) => {
    expect(decideContinuation("Crew 1", cont({ member }))).toMatchObject({ action: "withdraw", reason });
  });

  it("refuses earlier than it withdraws: refuse limits are strictly gentler than withdraw limits", () => {
    expect(AUTONOMY_THRESHOLDS.refuse.fatigue).toBeLessThan(AUTONOMY_THRESHOLDS.withdraw.fatigue);
    expect(AUTONOMY_THRESHOLDS.refuse.injuryRisk).toBeLessThan(AUTONOMY_THRESHOLDS.withdraw.injuryRisk);
    expect(AUTONOMY_THRESHOLDS.refuse.morale).toBeGreaterThan(AUTONOMY_THRESHOLDS.withdraw.morale);
    // A member between the two limits finishes what it is doing but takes no new work.
    const between = tired({ fatigue: (AUTONOMY_THRESHOLDS.refuse.fatigue + AUTONOMY_THRESHOLDS.withdraw.fatigue) / 2 });
    expect(decideContinuation("Crew 1", cont({ member: between })).action).toBe("continue");
    expect(decideOrder("Crew 1", order({ member: between })).action).toBe("refuse");
  });

  it("already returning or withdrawing crews are never told to withdraw again", () => {
    const bad = tired({ fatigue: 1, injuryRisk: 1, morale: 0 });
    expect(decideContinuation("Crew 1", cont({ member: bad, phase: "return" })).action).toBe("continue");
    expect(decideContinuation("Crew 1", cont({ member: bad, mode: "withdrawing", routeBlocked: true })).action).toBe("continue");
    expect(decideContinuation("Crew 1", cont({ member: bad, mode: "retreating", certifyFailure: "forecast_leg_unsafe" })).action).toBe("continue");
  });

  it("survival reasons outrank member condition when both apply", () => {
    const d = decideContinuation("Crew 1", cont({ routeBlocked: true, member: tired({ fatigue: 1 }) }));
    expect(d.reason).toBe("route_closed_by_observation");
  });
});
