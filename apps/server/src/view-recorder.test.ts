import { describe, expect, it } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { ViewRecorder } from "./view-recorder.js";

const sampleView = (sequence: number, simTimeMs: number): CoordinatorView =>
  CoordinatorView.parse({
    protocolVersion: 1,
    sequence,
    simTimeMs,
    wallElapsedMs: 0,
    incidentStatus: "active",
    activeRecipientId: null,
    agents: [],
    sites: [],
    observedCells: [],
    agentPlans: [],
    coordinatorForecast: null,
    recentReports: [],
    incidentEnd: null,
  });

describe("ViewRecorder", () => {
  it("dedupes consecutive identical sequence numbers", () => {
    const r = new ViewRecorder();
    r.record(sampleView(1, 0));
    r.record(sampleView(1, 0));
    expect(r.coordinatorLog()).toHaveLength(1);
  });

  it("keeps strictly increasing sequences", () => {
    const r = new ViewRecorder();
    r.record(sampleView(1, 0));
    r.record(sampleView(2, 5000));
    r.record(sampleView(3, 10_000));
    expect(r.coordinatorLog().map((v) => v.sequence)).toEqual([1, 2, 3]);
  });
});
