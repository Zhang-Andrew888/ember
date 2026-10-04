import { describe, expect, it } from "vitest";
import { ZodObject } from "zod";
import * as domain from "./index.js";
import { CoordinatorCurrentFireView, CoordinatorView, WIRE_PROTOCOL_VERSION } from "./index.js";

/** Minimal valid view; the shared coordinator fixture lives outside this package's rootDir. */
const baseView = {
  protocolVersion: WIRE_PROTOCOL_VERSION,
  sequence: 1,
  simTimeMs: 90_000,
  wallElapsedMs: 18_000,
  incidentStatus: "active",
  activeRecipientId: null,
  agents: [],
  sites: [],
  observedCells: [],
  agentPlans: [],
  coordinatorForecast: null,
  recentReports: [],
  incidentEnd: null,
};

const currentFire = { simTimeMs: 90_000, burningCells: [10, 11, 74], burnedCells: [3] };

describe("issue #112 — coordinator current-fire contract", () => {
  it("keeps views without currentFire valid", () => {
    expect(CoordinatorView.parse(baseView).currentFire).toBeUndefined();
  });

  it("round-trips currentFire on a CoordinatorView", () => {
    const view = CoordinatorView.parse({ ...baseView, currentFire });
    expect(view.currentFire).toEqual(currentFire);
  });

  it("accepts an empty fire", () => {
    expect(CoordinatorCurrentFireView.safeParse({ simTimeMs: 0, burningCells: [], burnedCells: [] }).success).toBe(true);
  });

  it("rejects cells outside the 64 x 64 grid and non-integer cells", () => {
    for (const bad of [-1, 4096, 1.5]) {
      expect(CoordinatorCurrentFireView.safeParse({ ...currentFire, burningCells: [bad] }).success).toBe(false);
      expect(CoordinatorCurrentFireView.safeParse({ ...currentFire, burnedCells: [bad] }).success).toBe(false);
    }
  });

  it("rejects unsorted or duplicate cells", () => {
    expect(CoordinatorCurrentFireView.safeParse({ ...currentFire, burningCells: [11, 10] }).success).toBe(false);
    expect(CoordinatorCurrentFireView.safeParse({ ...currentFire, burnedCells: [3, 3] }).success).toBe(false);
  });

  it("rejects a cell that is both burning and burned", () => {
    expect(CoordinatorCurrentFireView.safeParse({ ...currentFire, burnedCells: [11] }).success).toBe(false);
  });

  it("carries no private parameters, timers, or future state", () => {
    expect(Object.keys(CoordinatorCurrentFireView.parse(currentFire)).sort()).toEqual([
      "burnedCells",
      "burningCells",
      "simTimeMs",
    ]);
    // Zod strips unknown keys, so a payload cannot smuggle private data through the contract.
    const smuggled = CoordinatorCurrentFireView.parse({
      ...currentFire,
      spreadMultiplier: 1.4,
      windShiftTimeMs: 400_000,
      ignitedAtMs: { 10: 1_000 },
      futureBurningCells: [200],
    });
    expect(Object.keys(smuggled).sort()).toEqual(["burnedCells", "burningCells", "simTimeMs"]);
  });

  it("appears on CoordinatorView and no other domain schema", () => {
    const withField = Object.entries(domain)
      .filter(([, value]) => value instanceof ZodObject && "currentFire" in value.shape)
      .map(([name]) => name);
    expect(withField).toEqual(["CoordinatorView"]);
  });
});
