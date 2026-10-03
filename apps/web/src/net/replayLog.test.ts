import { describe, it, expect } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { replayLog } from "./replayLog.js";

describe("net/replayLog", () => {
  it("is a non-empty, schema-valid log", () => {
    expect(replayLog.length).toBeGreaterThan(3);
    for (const snapshot of replayLog) {
      expect(() => CoordinatorView.parse(snapshot)).not.toThrow();
    }
  });

  it("is ordered by strictly increasing sequence", () => {
    const sequences = replayLog.map((s) => s.sequence as number);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it("is ordered by non-decreasing simTimeMs", () => {
    const times = replayLog.map((s) => s.simTimeMs as number);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("starts active with no observations and ends with the incident over", () => {
    expect(replayLog[0]!.incidentStatus).toBe("active");
    expect(replayLog[0]!.observedCells).toHaveLength(0);

    const last = replayLog[replayLog.length - 1]!;
    expect(last.incidentStatus).toBe("ended");
    expect(last.incidentEnd).not.toBeNull();
  });

  it("every snapshot before the last has incidentEnd: null", () => {
    for (const snapshot of replayLog.slice(0, -1)) {
      expect(snapshot.incidentEnd).toBeNull();
    }
  });
});
