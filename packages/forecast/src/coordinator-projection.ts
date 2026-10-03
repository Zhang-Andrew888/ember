import type { CoordinatorEdgeArrivalBand, CoordinatorForecastView } from "@ember/domain";
import { SimTimeMs } from "@ember/domain";
import type { RoadIndex } from "@ember/simulation/model";
import type { ForecastEnsemble } from "./types.js";

/**
 * Build per-road-edge ignition bands from a supported ensemble for coordinator map display (#2).
 * Uses the earliest cell ignition along each edge across members; null when no member ignites
 * any cell on that edge before the ensemble horizon.
 */
export function edgeArrivalBands(
  ensemble: ForecastEnsemble,
  road: RoadIndex,
  nowMs: number,
): CoordinatorEdgeArrivalBand[] {
  const horizon = ensemble.horizonEndMs;
  const out: CoordinatorEdgeArrivalBand[] = [];
  for (const edge of road.edges.values()) {
    let earliest = Infinity;
    let latest = -Infinity;
    for (const member of ensemble.members) {
      for (const c of edge.cells) {
        const t = member.ignitionMs[c.cell] ?? Infinity;
        if (t === Infinity || t < nowMs || t > horizon) continue;
        if (t < earliest) earliest = t;
        if (t > latest) latest = t;
      }
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
        earliestIgnitionMs: SimTimeMs.parse(Math.round(earliest)),
        latestIgnitionMs: SimTimeMs.parse(Math.round(latest)),
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
    explanation,
    edgeArrivals: edgeArrivalBands(ensemble, road, nowMs),
  };
}
