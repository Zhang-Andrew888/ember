import { describe, expect, it } from "vitest";
import { CoordinatorView, MissionWork, Objective, WIRE_PROTOCOL_VERSION } from "./index.js";

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

describe("fire line contract", () => {
  const objective = {
    id: "obj-1",
    recipientId: "crew-1",
    kind: "build_line",
    targetId: null,
    issueSequence: 1,
  };

  const start = { x: 300, y: 400 };
  const end = { x: 300, y: 900 };

  it("needs two different end points on a build_line objective", () => {
    expect(Objective.safeParse({ ...objective, constraints: { line: { start, end } } }).success).toBe(true);
    expect(Objective.safeParse({ ...objective, constraints: {} }).success).toBe(false);
    expect(Objective.safeParse({ ...objective, constraints: { line: { start, end: start } } }).success).toBe(false);
  });

  it("rejects line points off the map and the old node-to-node form", () => {
    expect(Objective.safeParse({ ...objective, constraints: { line: { start, end: { x: 300, y: 1601 } } } }).success).toBe(false);
    expect(Objective.safeParse({ ...objective, constraints: { line: { fromNodeId: "n-h", toNodeId: "n-n" } } }).success).toBe(false);
    expect(MissionWork.safeParse({ kind: "build_line", fromNodeId: "n-h", toNodeId: "n-n" }).success).toBe(false);
  });

  it("carries build_line work on a mission", () => {
    expect(MissionWork.parse({ kind: "build_line", workNodeId: "n-h", start, end }).kind).toBe("build_line");
    expect(MissionWork.safeParse({ kind: "build_line", start, end }).success).toBe(false);
  });

  it("round-trips clearing cells and fire lines, and rejects a clearance outside (0, 1)", () => {
    const view = CoordinatorView.parse({
      ...baseView,
      clearingCells: [{ gridCellIndex: 40, clearance: 0.4 }],
      firelines: [{ id: "line:40~104", start: { x: 40, y: 20 }, end: { x: 40, y: 140 }, cells: [40, 104], resolved: false }],
    });
    expect(view.clearingCells?.[0]?.clearance).toBe(0.4);
    expect(view.firelines?.[0]?.cells).toEqual([40, 104]);
    expect(view.firelines?.[0]?.end).toEqual({ x: 40, y: 140 });
    for (const clearance of [0, 1]) {
      expect(CoordinatorView.safeParse({ ...baseView, clearingCells: [{ gridCellIndex: 40, clearance }] }).success).toBe(false);
    }
  });
});
