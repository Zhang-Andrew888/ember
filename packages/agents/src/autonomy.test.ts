import { describe, expect, it } from "vitest";
import { decideContinuation, decideOrder, type ContinuationInput, type OrderInput } from "./autonomy.js";

const order = (over: Partial<OrderInput> = {}): OrderInput => ({
  kind: "protect_site",
  forecastReliable: true,
  feasible: true,
  limitingReason: null,
  ...over,
});
const cont = (over: Partial<ContinuationInput> = {}): ContinuationInput => ({
  phase: "work",
  mode: "normal",
  routeBlocked: false,
  certifyFailure: null,
  forecastReliable: true,
  ...over,
});

describe("when a crew refuses an order", () => {
  it("accepts a feasible protect order without chatter", () => {
    expect(decideOrder("Crew 1", order())).toMatchObject({ action: "accept", reason: "order_accepted", announcement: null });
  });

  it("accepts a feasible observe order the same way", () => {
    expect(decideOrder("Scout", order({ kind: "observe" })).action).toBe("accept");
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

  it("refuses new protection work while the forecast is unreliable, even if a mission looks feasible", () => {
    expect(decideOrder("Crew 1", order({ forecastReliable: false }))).toMatchObject({ action: "refuse", reason: "forecast_unreliable" });
  });

  it.each(["return_to_refuge", "hold", "avoid_corridor", "resume"] as const)("never refuses a safety-tightening %s order, even with an unreliable forecast", (kind) => {
    expect(decideOrder("Crew 1", order({ kind, forecastReliable: false, feasible: false })).action).toBe("accept");
  });

  it("refuses an unsupported order kind", () => {
    expect(decideOrder("Crew 1", order({ kind: "teleport" }))).toMatchObject({ action: "refuse", reason: "objective_not_supported" });
  });
});

describe("when a crew withdraws", () => {
  it("continues a certified plan silently", () => {
    expect(decideContinuation("Crew 1", cont())).toMatchObject({ action: "continue", announcement: null });
  });

  it("withdraws when a direct observation closed the route, urgently", () => {
    const d = decideContinuation("Crew 1", cont({ routeBlocked: true }));
    expect(d).toMatchObject({ action: "withdraw", reason: "route_closed_by_observation" });
    expect(d.announcement).toMatchObject({ urgent: true });
    expect(d.announcement?.text).toMatch(/^Crew 1 is withdrawing/);
  });

  it("withdraws when the plan no longer certifies, keeping the certifier's reason", () => {
    expect(decideContinuation("Crew 1", cont({ certifyFailure: "forecast_work_unsafe" }))).toMatchObject({ action: "withdraw", reason: "forecast_work_unsafe" });
  });

  it("withdraws when the forecast becomes unreliable", () => {
    expect(decideContinuation("Crew 1", cont({ forecastReliable: false }))).toMatchObject({ action: "withdraw", reason: "forecast_unreliable" });
  });

  it.each(["approach", "work", "return"] as const)("withdraws from the %s phase", (phase) => {
    expect(decideContinuation("Crew 1", cont({ phase, routeBlocked: true })).action).toBe("withdraw");
  });

  it("a crew on its normal return still withdraws when its route closes", () => {
    expect(decideContinuation("Crew 1", cont({ phase: "return", routeBlocked: true })).action).toBe("withdraw");
    expect(decideContinuation("Crew 1", cont({ phase: "return", certifyFailure: "forecast_leg_unsafe" })).action).toBe("withdraw");
  });

  it.each(["withdrawing", "retreating"] as const)("a %s crew is never told to withdraw again", (mode) => {
    expect(decideContinuation("Crew 1", cont({ mode, routeBlocked: true, certifyFailure: "forecast_leg_unsafe" })).action).toBe("continue");
  });

  it("a direct observation outranks a certifier failure, which outranks an unreliable forecast", () => {
    const all = cont({ routeBlocked: true, certifyFailure: "forecast_leg_unsafe", forecastReliable: false });
    expect(decideContinuation("Crew 1", all).reason).toBe("route_closed_by_observation");
    expect(decideContinuation("Crew 1", { ...all, routeBlocked: false }).reason).toBe("forecast_leg_unsafe");
    expect(decideContinuation("Crew 1", { ...all, routeBlocked: false, certifyFailure: null }).reason).toBe("forecast_unreliable");
  });
});
