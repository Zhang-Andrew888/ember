import { describe, expect, it } from "vitest";
import { transportModeFromStartPlan } from "./transportMode.js";

describe("transportModeFromStartPlan", () => {
  it("marks mock when no REST or WS env is configured", () => {
    expect(transportModeFromStartPlan({ kind: "mock" })).toBe("mock");
  });

  it("marks live for REST create-incident and preconfigured WS", () => {
    expect(transportModeFromStartPlan({ kind: "create-incident" })).toBe("live");
    expect(transportModeFromStartPlan({ kind: "preconfigured" })).toBe("live");
  });
});
