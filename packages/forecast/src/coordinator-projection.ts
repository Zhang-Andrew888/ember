import type { CoordinatorEdgeArrivalBand, CoordinatorForecastView } from "@ember/domain";
import { SimTimeMs } from "@ember/domain";
import type { RoadIndex } from "@ember/simulation/model";
import type { ForecastEnsemble } from "./types.js";
import { ensembleValidity } from "./ensemble.js";

/**
 * Build per-road-edge ignition bands from a supported ensemble for coordinator map display (#2).
 * Each member contributes its first ignition on the edge. A non-arrival in any member leaves
 * the upper bound unknown. Invalid ensembles have no authorized band.
 */
export function edgeArrivalBands(
  ensemble: ForecastEnsemble,
  road: RoadIndex,
  _nowMs: number,
): CoordinatorEdgeArrivalBand[] {
  const horizon = ensemble.horizonEndMs;
  const out: CoordinatorEdgeArrivalBand[] = [];
  for (const edge of road.edges.values()) {
    if (ensembleValidity(ensemble) !== "valid") {
      out.push({ edgeId: edge.id, earliestIgnitionMs: null, latestIgnitionMs: null });
      continue;
    }
    let earliest = Infinity;
    let latest = -Infinity;
    let hasNonArrival = false;
    for (const member of ensemble.members) {
      let memberArrival = Infinity;
      for (const c of edge.cells) {
        const t = member.ignitionMs[c.cell] ?? Infinity;
        if (t <= horizon && t < memberArrival) memberArrival = t;
      }
      if (!Number.isFinite(memberArrival)) { hasNonArrival = true; continue; }
      if (memberArrival < earliest) earliest = memberArrival;
      if (memberArrival > latest) latest = memberArrival;
    }
    if (earliest === Infinity) {
      out.push({
        edgeId: edge.id,
        earliestIgnitionMs: null,
        latestIgnitionMs: null,
      });
    } else {
      out.push({
        edgeId: edge.id,
        earliestIgnitionMs: SimTimeMs.parse(Math.max(0, Math.round(earliest - (ensemble.arrivalPaddingMs ?? 0)))),
        latestIgnitionMs: hasNonArrival ? null : SimTimeMs.parse(Math.min(horizon, Math.round(latest + (ensemble.arrivalPaddingMs ?? 0)))),
      });
    }
  }
  return out;
}

export function toCoordinatorForecastView(
  ensemble: ForecastEnsemble | null,
  road: RoadIndex,
  nowMs: number,
  explanation: string | null,
): CoordinatorForecastView | null {
  if (ensemble === null) return null;
  const reliability =
    ensemble.reliability === "rebuilding" ? "rebuilding" : ensemble.reliability === "unreliable" ? "unreliable" : "reliable";
  return {
    reliability,
    supportedMemberCount: ensemble.members.length,
    explanation: explanation ?? (ensembleValidity(ensemble) !== "valid" ? "Forecast ensemble is invalid; protection work is not authorized." : null),
    edgeArrivals: edgeArrivalBands(ensemble, road, nowMs),
  };
}
