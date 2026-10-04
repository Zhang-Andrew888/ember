/**
 * Static briefing content shown before the incident starts. In the real
 * transport contract this comes from `POST /incidents` (docs/ARCHITECTURE.md),
 * which doesn't exist yet (apps/server is still a stub). Authored to match
 * the mock/fixture scenario in net/mockIncidentSocket.ts exactly, so the
 * briefing never promises an agent or site the live demo doesn't have.
 */
import { omitScoutCallsigns } from "../format/omitScout.js";

export interface BriefingSite {
  readonly name: string;
  readonly value: number;
}

export const briefingSites: BriefingSite[] = [
  { name: "Ridge Cabins", value: 1 },
  { name: "Waterworks", value: 1.5 },
  { name: "Community Lodge", value: 2 },
];

export const briefingCallsigns: string[] = ["Crew 1", "Crew 2"];

export interface BriefingContent {
  readonly sites: readonly BriefingSite[];
  readonly callsigns: readonly string[];
}

/** The authored list, which matches the mock demo exactly. */
export const mockBriefing: BriefingContent = { sites: briefingSites, callsigns: briefingCallsigns };

/**
 * What the briefing promises. The mock demo keeps its authored list; a live run uses the scenario's
 * public roster (docs/FRONTEND.md: three sites, four callsigns) so the briefing matches the game
 * that starts. A scenario with no roster falls back to the authored list per field.
 */
export function briefingContent(
  scenario: { readonly briefing: BriefingContent },
  mock: boolean,
): BriefingContent {
  if (mock) return mockBriefing;
  const { sites } = scenario.briefing;
  // The demo presents crews only (#118), even if a scenario file's roster still lists a scout.
  const callsigns = omitScoutCallsigns(scenario.briefing.callsigns);
  return {
    sites: sites.length > 0 ? sites : briefingSites,
    callsigns: callsigns.length > 0 ? callsigns : briefingCallsigns,
  };
}

export const briefingIncidentLabel =
  "Fictional incident - Ember Line training scenario. No real wildfire, location, or agency is depicted.";
