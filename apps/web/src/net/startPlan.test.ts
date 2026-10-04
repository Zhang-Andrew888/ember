import { describe, expect, it } from "vitest";
import { planStart } from "./startPlan.js";

describe("planStart", () => {
  it("mock demo when nothing is configured", () => {
    expect(planStart({ wsUrl: undefined, restBase: undefined })).toEqual({ kind: "mock" });
  });

  it("creates an incident when only a REST base is set (an empty string means the Vite proxy)", () => {
    expect(planStart({ wsUrl: undefined, restBase: "" })).toEqual({ kind: "create-incident" });
    expect(planStart({ wsUrl: undefined, restBase: "http://127.0.0.1:3000" })).toEqual({ kind: "create-incident" });
  });

  it("a pre-configured WebSocket URL wins: no incident is created, even if a REST base is also set", () => {
    const ws = "ws://127.0.0.1:3000/incidents/abc/events";
    expect(planStart({ wsUrl: ws, restBase: undefined })).toEqual({ kind: "preconfigured" });
    expect(planStart({ wsUrl: ws, restBase: "http://127.0.0.1:3000" })).toEqual({ kind: "preconfigured" });
  });

  it("an empty WebSocket URL counts as not set", () => {
    expect(planStart({ wsUrl: "", restBase: undefined })).toEqual({ kind: "mock" });
    expect(planStart({ wsUrl: "", restBase: "" })).toEqual({ kind: "create-incident" });
  });
});
