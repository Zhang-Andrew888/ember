import { describe, it, expect } from "vitest";
import {
  AgentId,
  Observation,
  SimTimeMs,
  CoordinatorView,
  IncidentEnd,
  CommandReceipt,
  Meters,
  Objective,
} from "./index.js";

describe("domain/ids", () => {
  it("parses a string as AgentId", () => {
    expect(AgentId.parse("crew-1")).toBe("crew-1");
  });

  it("rejects non-string AgentId", () => {
    expect(() => AgentId.parse(42)).toThrow();
  });
});

describe("domain/units", () => {
  it("accepts zero SimTimeMs", () => {
    expect(SimTimeMs.parse(0)).toBe(0);
  });

  it("rejects negative SimTimeMs", () => {
    expect(() => SimTimeMs.parse(-1)).toThrow();
  });

  it("rejects fractional SimTimeMs (must be integer)", () => {
    expect(() => SimTimeMs.parse(1.5)).toThrow();
  });

  it("accepts zero Meters", () => {
    expect(Meters.parse(0)).toBe(0);
  });
});

describe("domain/records - Observation", () => {
  const validObservation = {
    id: "obs-1",
    sourceAgentId: "crew-1",
    observedAt: 5_000,
    receivedAt: 5_000,
    spatialFootprint: { centerX: 100, centerY: 200, radius: 150 },
    observedFields: [
      {
        kind: "cell",
        gridCellIndex: 3,
        burnState: "burning",
      },
    ],
  };

  it("parses a valid Observation", () => {
    expect(() => Observation.parse(validObservation)).not.toThrow();
  });

  it("rejects an Observation with a negative observedAt", () => {
    expect(() =>
      Observation.parse({ ...validObservation, observedAt: -1 }),
    ).toThrow();
  });

  it("parses a site observed field", () => {
    const withSite = {
      ...validObservation,
      observedFields: [
        {
          kind: "site",
          siteId: "site-a",
          completedWork: 100,
          damage: 0.05,
          destroyed: false,
        },
      ],
    };
    expect(() => Observation.parse(withSite)).not.toThrow();
  });
});

describe("domain/records - IncidentEnd", () => {
  it("parses a valid IncidentEnd with multiple reasons", () => {
    const end = {
      tick: 1_500_000,
      wallElapsedMs: 300_000,
      matchingReasons: ["time_expired", "all_sites_resolved"],
      displayReason: "all_sites_resolved",
      finalSnapshotHash: "abc123",
    };
    expect(() => IncidentEnd.parse(end)).not.toThrow();
  });
});

describe("domain/records - CommandReceipt", () => {
  it("parses an accepted receipt", () => {
    const receipt = {
      commandId: "cmd-1",
      status: "accepted",
      recipientId: "crew-2",
      appliedTick: 10_000,
      explanation: "Mission updated.",
      planRevision: 3,
    };
    expect(() => CommandReceipt.parse(receipt)).not.toThrow();
  });

  it("parses a receipt with null recipientId for clarification", () => {
    const receipt = {
      commandId: "cmd-2",
      status: "clarification_required",
      recipientId: null,
      appliedTick: null,
      explanation: "Recipient is ambiguous.",
      planRevision: null,
    };
    expect(() => CommandReceipt.parse(receipt)).not.toThrow();
  });
});

describe("domain/coordinator-view - CoordinatorView", () => {
  const minimalView = {
    protocolVersion: 1,
    sequence: 0,
    simTimeMs: 0,
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
  };

  it("parses a minimal CoordinatorView", () => {
    expect(() => CoordinatorView.parse(minimalView)).not.toThrow();
  });

  it("parses a CoordinatorView with an agent on a node", () => {
    const view = {
      ...minimalView,
      agents: [
        {
          id: "crew-1",
          role: "protection_crew",
          callsign: "Crew 1",
          position: { kind: "node", nodeId: "refuge-west" },
          state: "idle",
          reportedAt: 0,
        },
      ],
    };
    expect(() => CoordinatorView.parse(view)).not.toThrow();
  });

  it("parses a CoordinatorView with an agent on an edge", () => {
    const view = {
      ...minimalView,
      agents: [
        {
          id: "crew-1",
          role: "protection_crew",
          callsign: "Crew 1",
          position: {
            kind: "edge",
            edgeId: "edge-rw-sa",
            distanceAlongPolyline: 240.5,
            direction: "forward",
            turnaroundTimeRemaining: 0,
          },
          state: "approaching",
          reportedAt: 60_000,
        },
      ],
    };
    expect(() => CoordinatorView.parse(view)).not.toThrow();
  });

  it("rejects a CoordinatorView with an invalid incidentStatus", () => {
    expect(() =>
      CoordinatorView.parse({ ...minimalView, incidentStatus: "paused" }),
    ).toThrow();
  });

  it("parses avoid_corridor objectives", () => {
    expect(() =>
      Objective.parse({
        id: "obj-1",
        recipientId: "crew-1",
        kind: "avoid_corridor",
        targetId: "e-n-h",
        constraints: {},
        issueSequence: 1,
      }),
    ).not.toThrow();
  });
});
