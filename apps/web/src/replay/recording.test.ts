import { describe, expect, it } from "vitest";
import { mergeTruthCells, ReplayRecording, ReplayTruthFrame, truthFrameAt } from "./recording.js";
import { mockRecording, mockTruthFrames } from "./mockRecording.js";
import { scenarioMap } from "../map/activeScenario.js";
import type { FireCellMarker } from "../components/scene/sceneEntities.js";

function observed(index: number, burnState: FireCellMarker["burnState"], stale = false): FireCellMarker {
  return { key: `c${index}`, gridCellIndex: index, position: { x: 0, z: 0 }, burnState, stale, source: "observed", lastObservedAt: 1000, ageMs: 0 };
}

describe("ReplayRecording schema", () => {
  it("the mock recording validates", () => {
    expect(() => ReplayRecording.parse(mockRecording)).not.toThrow();
  });

  it("rejects unknown keys (nothing smuggled alongside the truth frames)", () => {
    expect(ReplayRecording.safeParse({ ...mockRecording, privateWorldParameters: {} }).success).toBe(false);
    expect(ReplayTruthFrame.safeParse({ timeMs: 0, burning: [], burned: [], windSeed: 1 }).success).toBe(false);
  });

  it("rejects out-of-grid cells and non-increasing frame times", () => {
    expect(ReplayTruthFrame.safeParse({ timeMs: 0, burning: [99999], burned: [] }).success).toBe(false);
    const frames = [mockTruthFrames[1]!, mockTruthFrames[0]!];
    expect(ReplayRecording.safeParse({ coordinatorLog: mockRecording.coordinatorLog, truthFrames: frames }).success).toBe(false);
  });
});

describe("mock truth reveals more than the coordinator ever saw", () => {
  const first = mockTruthFrames[0]!;
  const last = mockTruthFrames[mockTruthFrames.length - 1]!;

  it("starts from the briefed ignition patch", () => {
    expect([...first.burning].sort((a, b) => a - b)).toEqual([...scenarioMap.initialFireCells].sort((a, b) => a - b));
  });

  it("ends with far more fire than the six cells the live mock ever observes", () => {
    const observedMax = Math.max(...mockRecording.coordinatorLog.map((view) => view.observedCells.length));
    expect(last.burning.length + last.burned.length).toBeGreaterThan(observedMax * 5);
  });

  it("burning and burned never overlap within a frame", () => {
    for (const frame of mockTruthFrames) {
      const burned = new Set(frame.burned);
      expect(frame.burning.some((cell) => burned.has(cell))).toBe(false);
    }
  });
});

describe("truthFrameAt", () => {
  it("returns the latest frame at or before the time, null before the first", () => {
    expect(truthFrameAt(mockTruthFrames, 0)?.timeMs).toBe(0);
    expect(truthFrameAt(mockTruthFrames, 61_000)?.timeMs).toBe(60_000);
    expect(truthFrameAt(mockTruthFrames, 9_999_999)?.timeMs).toBe(300_000);
    expect(truthFrameAt([{ timeMs: 5000, burning: [], burned: [] }], 1000)).toBeNull();
  });
});

describe("mergeTruthCells", () => {
  const frame = { timeMs: 60_000, burning: [10, 11], burned: [12] };

  it("marks truth cells the coordinator never observed as unseen", () => {
    const merged = mergeTruthCells([], frame, scenarioMap);
    expect(merged).toHaveLength(3);
    expect(merged.every((cell) => cell.unseen === true)).toBe(true);
  });

  it("keeps a current, matching observation as the observed entry (not unseen)", () => {
    const merged = mergeTruthCells([observed(10, "burning")], frame, scenarioMap);
    const cell = merged.find((c) => c.gridCellIndex === 10)!;
    expect(cell.unseen).toBeUndefined();
    expect(cell.key).toBe("c10");
  });

  it("a stale observation is replaced by the truth, flagged unseen so it never reads as an observation with an age", () => {
    const merged = mergeTruthCells([observed(10, "burning", true)], frame, scenarioMap);
    expect(merged.find((c) => c.gridCellIndex === 10)).toMatchObject({ stale: false, unseen: true });
  });

  it("an observation of a different state is replaced too (burning observed, truth says burned)", () => {
    const merged = mergeTruthCells([observed(12, "burning")], frame, scenarioMap);
    expect(merged.find((c) => c.gridCellIndex === 12)).toMatchObject({ burnState: "burned", unseen: true });
  });

  it("observed cells the truth does not list survive (a false report stays visible as reported)", () => {
    const merged = mergeTruthCells([observed(40, "burning")], frame, scenarioMap);
    expect(merged.some((c) => c.gridCellIndex === 40)).toBe(true);
  });
});
