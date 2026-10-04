import type { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { adaptToScenarioIds } from "./mockBase.js";
import { omitScoutFromView } from "../format/omitScout.js";
import { authoredSnapshots } from "./mockIncidentSocket.js";
import { runEndedScenarios } from "./scenarios.js";

/**
 * A recorded log of CoordinatorView snapshots spanning one complete
 * incident, start to end, for the replay view (backlog item 5: "no sim
 * imports" - packages/replay is the real engine, sim-lane territory;
 * this is a web-lane-only mock log, reusing the same authored data the
 * rest of the app already uses rather than inventing a parallel dataset).
 *
 * docs/ARCHITECTURE.md's real `GET /incidents/:id/replay` would also
 * return authorized truth snapshots (the actual, complete fire) alongside
 * this kind of coordinator log. That truth channel doesn't exist anywhere
 * in this schema or this mock data yet, live or recorded - ReplayView
 * says so plainly rather than fabricating a "full simulated fire" layer
 * with no real data behind it.
 */
const rawReplayLog: CoordinatorView[] = [
  {
    ...fixtureCoordinatorView,
    sequence: 1 as CoordinatorView["sequence"],
    simTimeMs: 0 as CoordinatorView["simTimeMs"],
    wallElapsedMs: 0 as CoordinatorView["wallElapsedMs"],
    incidentStatus: "active",
    activeRecipientId: null,
    agentPlans: [],
    coordinatorForecast: null,
    agents: [
      { ...fixtureCoordinatorView.agents[1]!, state: "idle", reportedAt: 0 as never }, // crew-2, at refuge-west
      {
        ...fixtureCoordinatorView.agents[0]!,
        position: fixtureCoordinatorView.agents[1]!.position, // crew-1 also starts at refuge-west
        state: "idle",
        reportedAt: 0 as never,
      },
      {
        ...fixtureCoordinatorView.agents[2]!,
        position: { kind: "node", nodeId: "placeholder-node-refuge-south" as never },
        state: "idle",
        reportedAt: 0 as never,
      },
    ],
    sites: fixtureCoordinatorView.sites,
    observedCells: [],
    recentReports: [],
    incidentEnd: null,
  },
  { ...fixtureCoordinatorView, sequence: 2 as CoordinatorView["sequence"] },
  ...authoredSnapshots.slice(1).map((snapshot, index) => ({
    ...snapshot,
    sequence: (3 + index) as CoordinatorView["sequence"],
  })),
  { ...runEndedScenarios.time_expired, sequence: 10 as CoordinatorView["sequence"] },
];

/** The illustrative replay is part of the demo, so it presents crews only (#118). */
export const replayLog: CoordinatorView[] = rawReplayLog.map((view) => adaptToScenarioIds(omitScoutFromView(view)));
