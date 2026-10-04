import type { MockIncidentSocketOptions } from "./mockIncidentSocket.js";
import {
  emptyScenario,
  staleContradictionScenario,
  siteDamageScenario,
  modelStatesScenario,
  staleLaterScenario,
  runEndedScenarios,
  currentFireScenarios,
} from "./scenarios.js";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";

export const SCENARIO_QUERY_KEY = "scenario";

export const SCENARIO_NAMES = [
  "empty",
  "stale-contradiction",
  "site-damage",
  "model-states",
  "stale-transition",
  "ends-while-active",
  "ended-time-expired",
  "ended-fire-extinguished",
  "ended-all-sites-resolved",
  "ended-all-crews-lost",
  "connection-error",
  "disconnect",
  "current-fire",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(value);
}

/**
 * Maps a `?scenario=` query value to mock-socket options for backlog item
 * 1 ("every product-critical UI state against fixtures"). Pure (takes a
 * string, returns data) so it's testable without a browser; never
 * reachable without the query param, so it can't affect the default demo.
 */
export function resolveScenario(search: string): MockIncidentSocketOptions | null {
  const raw = new URLSearchParams(search).get(SCENARIO_QUERY_KEY);
  if (raw === null || !isScenarioName(raw)) return null;

  switch (raw) {
    case "empty":
      return { snapshots: [emptyScenario] };
    case "stale-contradiction":
      return { snapshots: [staleContradictionScenario] };
    case "site-damage":
      return { snapshots: [siteDamageScenario] };
    case "model-states":
      return { snapshots: [modelStatesScenario] };
    case "stale-transition":
      return { snapshots: [fixtureCoordinatorView, staleLaterScenario], intervalMs: 2000 };
    case "ends-while-active":
      // Starts live (so there's time to send a message / start a
      // push-to-talk hold), then transitions to ended 1.5s later - unlike
      // every other ended-* scenario, which is already ended on the very
      // first snapshot and so can never test what happens *during* the
      // active -> ended transition itself (docs/COMMUNICATION.md: "At
      // incident end, stop capture, cancel ... stale routine audio").
      return { snapshots: [fixtureCoordinatorView, runEndedScenarios.time_expired], intervalMs: 1500 };
    case "ended-time-expired":
      return { snapshots: [runEndedScenarios.time_expired] };
    case "ended-fire-extinguished":
      return { snapshots: [runEndedScenarios.fire_extinguished] };
    case "ended-all-sites-resolved":
      return { snapshots: [runEndedScenarios.all_sites_resolved] };
    case "ended-all-crews-lost":
      return { snapshots: [runEndedScenarios.all_protection_crews_lost] };
    case "connection-error":
      return { failToOpen: true };
    case "disconnect":
      return { disconnectAfterMs: 3000 };
    case "current-fire":
      return { snapshots: currentFireScenarios, intervalMs: 4000 };
  }
}
