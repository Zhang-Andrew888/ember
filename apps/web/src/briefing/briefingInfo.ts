/**
 * Static briefing content shown before the incident starts. In the real
 * transport contract this comes from `POST /incidents` (docs/ARCHITECTURE.md),
 * which doesn't exist yet (apps/server is still a stub). Authored to match
 * the mock/fixture scenario in net/mockIncidentSocket.ts exactly, so the
 * briefing never promises an agent or site the live demo doesn't have.
 */
export interface BriefingSite {
  readonly name: string;
  readonly value: number;
}

export const briefingSites: BriefingSite[] = [
  { name: "Ridge Cabins", value: 1 },
  { name: "Waterworks", value: 1.5 },
  { name: "Community Lodge", value: 2 },
];

export const briefingCallsigns: string[] = ["Crew 1", "Crew 2", "Scout"];

export const briefingIncidentLabel =
  "Fictional incident - Ember Line training scenario. No real wildfire, location, or agency is depicted.";
