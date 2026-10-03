import type { MockIncidentSocketOptions } from "./mockIncidentSocket.js";
import { emptyScenario, staleContradictionScenario, runEndedScenarios } from "./scenarios.js";

export const SCENARIO_QUERY_KEY = "scenario";

export const SCENARIO_NAMES = [
  "empty",
  "stale-contradiction",
  "ended-time-expired",
  "ended-fire-extinguished",
  "ended-all-sites-resolved",
  "ended-all-crews-lost",
  "connection-error",
  "disconnect",
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
  }
}
