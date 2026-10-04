import { describe, expect, it } from "vitest";
import { CoordinatorView, WIRE_PROTOCOL_VERSION } from "./index.js";

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

describe("coordinator firebreak contract", () => {
  it("keeps views without firebreakCells valid", () => {
    expect(CoordinatorView.parse(baseView).firebreakCells).toBeUndefined();
  });

  it("round-trips firebreak cells", () => {
    expect(CoordinatorView.parse({ ...baseView, firebreakCells: [40, 104, 4095] }).firebreakCells).toEqual([40, 104, 4095]);
  });

  it("rejects cells off the grid, unsorted or duplicated", () => {
    for (const bad of [[-1], [4096], [1.5], [104, 40], [40, 40]]) {
      expect(CoordinatorView.safeParse({ ...baseView, firebreakCells: bad }).success).toBe(false);
    }
  });
});
