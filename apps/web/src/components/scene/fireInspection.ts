import { formatIncidentClock } from "../../format/time.js";
import type { FireCellMarker } from "./sceneEntities.js";
import { formatObservationInspection } from "./staleness.js";

/** What the inspection panel says about a fire cell: its source and the time that source describes. */
export interface FireInspection {
  /** Where the displayed state comes from. */
  readonly source: string;
  readonly state: string;
  /** Names the clock the time below is on ("Feed time", "Last observed", ...). */
  readonly timeHeading: string;
  /** Always incident (simulation) time; null when it would add nothing. */
  readonly time: string | null;
}

/**
 * Source and time for a fire cell. Everything here is simulation time: the current-fire feed time
 * is `currentFire.simTimeMs` and an observation's age is simulation time since it was made.
 * Wall-clock time is never used or compared, so the two clocks cannot be confused.
 */
export function inspectFireCell(cell: FireCellMarker, simTimeMs: number | null): FireInspection {
  switch (cell.source) {
    case "current-fire":
      return {
        source: "Current fire (live coordinator feed)",
        state: cell.burnState,
        timeHeading: "Feed time",
        time: `${formatIncidentClock(cell.lastObservedAt)} incident time`,
      };
    case "observed":
      return {
        source: "Observed belief (crew sighting; may be old)",
        state: cell.stale ? `${cell.burnState}, stale` : cell.burnState,
        timeHeading: "Last observed",
        time: simTimeMs === null ? `${formatIncidentClock(cell.lastObservedAt)} incident time` : formatObservationInspection(cell.lastObservedAt, simTimeMs, cell.stale),
      };
    case "replay-truth":
      return {
        source: "Full simulated fire (replay only; not observed by the coordinator)",
        state: cell.burnState,
        timeHeading: "Simulated time",
        time: `${formatIncidentClock(cell.lastObservedAt)} incident time`,
      };
  }
}
