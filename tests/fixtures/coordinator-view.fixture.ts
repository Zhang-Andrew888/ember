/**
 * Recorded CoordinatorView snapshot at simTimeMs=90_000 (90 sim-seconds = 18 real-seconds in).
 *
 * Scenario state:
 * - Crew 1 is 360 m along the Refuge West - Ridge Cabins approach road, en route.
 * - Crew 2 is still idle at Refuge West (awaiting objective from coordinator).
 * - Scout has departed Refuge South and is 200 m along the north-sector scouting road.
 * - Initial 2x2 burning patch (upwind quadrant) was observed at briefing (t=0); now stale.
 * - Scout's t=85 s observation shows two new burning cells advancing north-east.
 * - No sites have been observed yet; all site fields are null.
 *
 * This fixture is authored for the web lane to build against. It does not represent
 * a deterministically run incident; node/edge IDs are placeholders until the real
 * OSM extract is ingested in Slice 0.
 */

import type { CoordinatorView } from "@ember/domain";

export const fixtureCoordinatorView: CoordinatorView = {
  protocolVersion: 1,
  sequence: 450 as unknown as CoordinatorView["sequence"],
  simTimeMs: 90_000 as unknown as CoordinatorView["simTimeMs"],
  wallElapsedMs: 18_000 as unknown as CoordinatorView["wallElapsedMs"],
  incidentStatus: "active",
  activeRecipientId: null,

  agents: [
    {
      id: "crew-1" as unknown as CoordinatorView["agents"][number]["id"],
      role: "protection_crew",
      callsign: "Crew 1",
      position: {
        kind: "edge",
        edgeId: "placeholder-edge-refuge-west-site-a" as unknown as never,
        distanceAlongPolyline: 360 as unknown as never,
        direction: "forward",
        turnaroundTimeRemaining: 0 as unknown as never,
      },
      state: "approaching",
      reportedAt: 90_000 as unknown as never,
    },
    {
      id: "crew-2" as unknown as CoordinatorView["agents"][number]["id"],
      role: "protection_crew",
      callsign: "Crew 2",
      position: {
        kind: "node",
        nodeId: "placeholder-node-refuge-west" as unknown as never,
      },
      state: "idle",
      reportedAt: 90_000 as unknown as never,
    },
    {
      id: "scout" as unknown as CoordinatorView["agents"][number]["id"],
      role: "scout",
      callsign: "Scout",
      position: {
        kind: "edge",
        edgeId: "placeholder-edge-refuge-south-north-sector" as unknown as never,
        distanceAlongPolyline: 200 as unknown as never,
        direction: "forward",
        turnaroundTimeRemaining: 0 as unknown as never,
      },
      state: "approaching",
      reportedAt: 85_000 as unknown as never,
    },
  ],

  sites: [
    {
      id: "site-a" as unknown as CoordinatorView["sites"][number]["id"],
      name: "Ridge Cabins",
      nodeId: "placeholder-node-site-a" as unknown as never,
      value: 1,
      observedCompletedWork: null,
      observedDamage: null,
      observedDestroyed: null,
      lastObservedAt: null,
      stale: false,
    },
    {
      id: "site-b" as unknown as CoordinatorView["sites"][number]["id"],
      name: "Waterworks",
      nodeId: "placeholder-node-site-b" as unknown as never,
      value: 1.5,
      observedCompletedWork: null,
      observedDamage: null,
      observedDestroyed: null,
      lastObservedAt: null,
      stale: false,
    },
    {
      id: "site-c" as unknown as CoordinatorView["sites"][number]["id"],
      name: "Community Lodge",
      nodeId: "placeholder-node-site-c" as unknown as never,
      value: 2,
      observedCompletedWork: null,
      observedDamage: null,
      observedDestroyed: null,
      lastObservedAt: null,
      stale: false,
    },
  ],

  observedCells: [
    { gridCellIndex: 1100, burnState: "burning", lastObservedAt: 0 as unknown as never, stale: true, observerAgentId: "crew-1" as unknown as never },
    { gridCellIndex: 1101, burnState: "burning", lastObservedAt: 0 as unknown as never, stale: true, observerAgentId: "crew-1" as unknown as never },
    { gridCellIndex: 1164, burnState: "burning", lastObservedAt: 0 as unknown as never, stale: true, observerAgentId: "crew-1" as unknown as never },
    { gridCellIndex: 1165, burnState: "burning", lastObservedAt: 0 as unknown as never, stale: true, observerAgentId: "crew-1" as unknown as never },
    { gridCellIndex: 1203, burnState: "burning", lastObservedAt: 85_000 as unknown as never, stale: false, observerAgentId: "scout" as unknown as never },
    { gridCellIndex: 1180, burnState: "burning", lastObservedAt: 85_000 as unknown as never, stale: false, observerAgentId: "scout" as unknown as never },
  ],
  agentPlans: [
    {
      agentId: "crew-1" as unknown as never,
      planId: "plan-fixture-crew-1" as unknown as never,
      legs: [{ edgeId: "placeholder-edge-refuge-west-site-a" as unknown as never, direction: "forward" as const }],
      workInterval: { startMs: 120_000 as unknown as never, endMs: 420_000 as unknown as never },
      refugeId: "placeholder-node-refuge-west" as unknown as never,
      phase: "approach",
      limitingReason: null,
    },
  ],
  coordinatorForecast: {
    reliability: "reliable",
    supportedMemberCount: 24,
    explanation: null,
    edgeArrivals: [
      {
        edgeId: "placeholder-edge-refuge-west-site-a" as unknown as never,
        earliestIgnitionMs: 600_000 as unknown as never,
        latestIgnitionMs: 900_000 as unknown as never,
      },
    ],
  },

  recentReports: [
    {
      sequence: 1 as unknown as never,
      simTimeMs: 5_000 as unknown as never,
      agentId: "crew-1" as unknown as never,
      text: "Crew 1 departing Refuge West, en route to Ridge Cabins.",
      urgent: false,
    },
    {
      sequence: 2 as unknown as never,
      simTimeMs: 8_000 as unknown as never,
      agentId: "scout" as unknown as never,
      text: "Scout departing Refuge South, moving to upwind observation position.",
      urgent: false,
    },
    {
      sequence: 3 as unknown as never,
      simTimeMs: 85_000 as unknown as never,
      agentId: "scout" as unknown as never,
      text: "Scout: fire spreading north-east on two cells, 200 m from original patch.",
      urgent: false,
    },
  ],

  incidentEnd: null,
};
