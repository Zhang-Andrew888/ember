import type { CoordinatorView, EndReason } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";

/**
 * Dev/test-only scenario content (backlog item 1: "every product-critical
 * UI state against fixtures"). Each is hand-authored from the shared
 * fixture's shape - the fixture itself is never edited, per AGENTS.md.
 * Selected via net/scenarioSelection.ts; never reachable in the default
 * demo flow.
 */

/** Before any agent has reported in: public briefing data only, nothing observed yet. */
export const emptyScenario: CoordinatorView = {
  ...fixtureCoordinatorView,
  sequence: 1 as CoordinatorView["sequence"],
  simTimeMs: 0 as CoordinatorView["simTimeMs"],
  wallElapsedMs: 0 as CoordinatorView["wallElapsedMs"],
  incidentStatus: "active",
  activeRecipientId: null,
  agents: [],
  observedCells: [],
  agentPlans: [],
  coordinatorForecast: null,
  recentReports: [],
  incidentEnd: null,
};

/**
 * A cell with two conflicting reports: the fixture's own stale "burning"
 * entry, contradicted by a fresher "unburned" one. Exercises
 * sceneEntities.ts's freshest-wins resolution end-to-end (not just the
 * unit test) and the "stale 'clear' observations do not become current
 * clearance" rule in reverse (fresh clearance beats a stale hazard report).
 */
export const staleContradictionScenario: CoordinatorView = {
  ...fixtureCoordinatorView,
  sequence: 500 as CoordinatorView["sequence"],
  observedCells: [
    ...fixtureCoordinatorView.observedCells,
    {
      ...fixtureCoordinatorView.observedCells[0]!,
      burnState: "unburned",
      lastObservedAt: 92_000 as never,
      stale: false,
      observerAgentId: "crew-1" as never,
    },
  ],
};

/**
 * A site with observed damage but still under active protection work -
 * exercises the damage ring in SiteMarkers.tsx (docs/FRONTEND.md: "Site
 * protection and site damage have separate indicators. '60% protected' is
 * not '60% health'"). No existing scenario/fixture/mock snapshot ever sets
 * observedDamage above 0, so this path had never actually been rendered or
 * checked live before this scenario was added.
 */
export const siteDamageScenario: CoordinatorView = {
  ...fixtureCoordinatorView,
  sequence: 600 as CoordinatorView["sequence"],
  sites: [
    {
      ...fixtureCoordinatorView.sites[0]!,
      observedCompletedWork: 20 as never,
      observedDamage: 0.4 as never,
      observedDestroyed: false,
      lastObservedAt: 120_000 as never,
      stale: false,
    },
    fixtureCoordinatorView.sites[1]!,
    fixtureCoordinatorView.sites[2]!,
  ],
};

function endedView(
  displayReason: EndReason,
  overrides: Partial<CoordinatorView> = {},
  matchingReasons: EndReason[] = [displayReason],
): CoordinatorView {
  return {
    ...fixtureCoordinatorView,
    sequence: 999 as CoordinatorView["sequence"],
    simTimeMs: 300_000 as CoordinatorView["simTimeMs"],
    wallElapsedMs: 300_000 as CoordinatorView["wallElapsedMs"],
    incidentStatus: "ended",
    incidentEnd: {
      tick: 300_000 as never,
      wallElapsedMs: 300_000 as never,
      matchingReasons,
      displayReason,
      finalSnapshotHash: "mock-scenario-hash",
    },
    ...overrides,
  };
}

/** One ended view per EndReason, each with data consistent with that reason. */
export const runEndedScenarios: Record<EndReason, CoordinatorView> = {
  time_expired: endedView("time_expired"),

  fire_extinguished: endedView("fire_extinguished", {
    observedCells: fixtureCoordinatorView.observedCells.map((cell) => ({
      ...cell,
      burnState: "unburned",
      stale: false,
      lastObservedAt: 300_000 as never,
    })),
  }),

  all_sites_resolved: endedView("all_sites_resolved", {
    sites: fixtureCoordinatorView.sites.map((site) => ({
      ...site,
      observedCompletedWork: 100 as never,
      observedDamage: 0 as never,
      observedDestroyed: false,
      lastObservedAt: 300_000 as never,
      stale: false,
    })),
  }),

  // docs/VALIDATION.md: "All protection crews lost, scout alive: Immediate
  // end; scout remains recorded alive."
  all_protection_crews_lost: endedView("all_protection_crews_lost", {
    agents: fixtureCoordinatorView.agents.map((agent) =>
      agent.role === "protection_crew" ? { ...agent, state: "lost" } : agent,
    ),
  }),
};

/**
 * Every agent state and every site protection status on screen at once, for
 * checking that each has its own shape cue (dev preset `?scenario=model-states`).
 * Authored directly on the real scenario ids (the id adapter leaves them alone).
 */
export const modelStatesScenario: CoordinatorView = {
  ...fixtureCoordinatorView,
  sequence: 700 as CoordinatorView["sequence"],
  agentPlans: [],
  coordinatorForecast: null,
  agents: [
    edgeAgent("crew-1", "Crew 1", "protection_crew", "approaching", "e-rw-j1", 120),
    edgeAgent("crew-2", "Crew 2", "protection_crew", "withdrawing", "e-j1-s", 150),
    // Crew 3 last reported 60 sim-seconds ago: its marker must fade and hatch.
    edgeAgent("crew-3", "Crew 3", "protection_crew", "retreating", "e-rs-s", 160, 30_000),
    edgeAgent("scout", "Scout", "scout", "working", "e-n-h", 200),
    edgeAgent("crew-4", "Crew 4", "protection_crew", "lost", "e-j1-n", 150),
    nodeAgent("crew-5", "Crew 5", "protection_crew", "working", "n-sa"),
  ],
  sites: [
    { ...fixtureCoordinatorView.sites[0]!, nodeId: "n-sa" as never, observedCompletedWork: 40 as never, observedDamage: 0.3 as never, observedDestroyed: false, lastObservedAt: 85_000 as never, stale: false },
    { ...fixtureCoordinatorView.sites[1]!, nodeId: "n-sb" as never, observedCompletedWork: null, observedDamage: null, observedDestroyed: null, lastObservedAt: null, stale: false },
    { ...fixtureCoordinatorView.sites[2]!, nodeId: "n-sc" as never, observedCompletedWork: 0 as never, observedDamage: 1 as never, observedDestroyed: true, lastObservedAt: 60_000 as never, stale: true },
  ],
};

function edgeAgent(
  id: string,
  callsign: string,
  role: CoordinatorView["agents"][number]["role"],
  state: CoordinatorView["agents"][number]["state"],
  edgeId: string,
  distance: number,
  reportedAt = 90_000,
): CoordinatorView["agents"][number] {
  return {
    id: id as never,
    role,
    callsign,
    state,
    position: {
      kind: "edge",
      edgeId: edgeId as never,
      distanceAlongPolyline: distance as never,
      direction: "forward",
      turnaroundTimeRemaining: 0 as never,
    },
    reportedAt: reportedAt as never,
  };
}

function nodeAgent(
  id: string,
  callsign: string,
  role: CoordinatorView["agents"][number]["role"],
  state: CoordinatorView["agents"][number]["state"],
  nodeId: string,
): CoordinatorView["agents"][number] {
  return {
    id: id as never,
    role,
    callsign,
    state,
    position: { kind: "node", nodeId: nodeId as never },
    reportedAt: 90_000 as never,
  };
}
