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
  sequence: 1 as CoordinatorView["sequence"],
  simTimeMs: 0 as CoordinatorView["simTimeMs"],
  wallElapsedMs: 0 as CoordinatorView["wallElapsedMs"],
  incidentStatus: "active",
  activeRecipientId: null,
  agents: [],
  sites: fixtureCoordinatorView.sites,
  observedCells: [],
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
