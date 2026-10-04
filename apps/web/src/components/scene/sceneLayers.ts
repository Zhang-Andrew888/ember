import type { CoordinatorView } from "@ember/domain";
import type { ScenarioMap } from "../../map/scenarioMap.js";
import { resolveEdgePolyline, type SceneVector } from "../../map/positions.js";
import { limitingReasonDisplayText } from "../../format/limitingReason.js";
import { formatIncidentClock, INCIDENT_SIM_HORIZON_MS } from "../../format/time.js";

/**
 * Pure builders for the route-emphasis and forecast layers. They consume
 * only CoordinatorView (`agentPlans`, `coordinatorForecast` from packages/domain)
 * so nothing here can leak unknown fire.
 */

export type RoutePhase = "approach" | "work" | "return";

export interface RouteLine {
  readonly key: string;
  readonly agentId: string;
  readonly callsign: string;
  readonly phase: RoutePhase;
  /** Polyline in travel order (approach/return legs already oriented by direction). */
  readonly points: SceneVector[];
  readonly selected: boolean;
  /** Plain-text description, also used for the label so phase never depends on line style alone. */
  readonly label: string;
  readonly limitingReason: string | null;
}

const PHASE_WORD: Record<RoutePhase, string> = {
  approach: "approaching",
  work: "working",
  return: "returning",
};

/**
 * One RouteLine per reportable plan. Legs are concatenated into a single
 * polyline; a leg whose edge is unknown to the map is skipped (never drawn
 * at a fallback position).
 */
export function buildRouteLines(
  view: CoordinatorView,
  map: ScenarioMap,
  selectedAgentId: string | null,
): RouteLine[] {
  const lines: RouteLine[] = [];
  for (const plan of view.agentPlans) {
    const agent = view.agents.find((candidate) => candidate.id === plan.agentId);
    // A recorded or delayed plan can outlive its crew's reported activity.
    if (!agent || agent.state === "lost" || agent.state === "idle") continue;
    if (plan.phase === "approach" && agent.state !== "approaching") continue;
    if (plan.phase === "work" && agent.state !== "working") continue;
    if (plan.phase === "return" && agent.state === "working") continue;
    const points: SceneVector[] = [];
    for (const leg of plan.legs) {
      const polyline = resolveEdgePolyline(map, leg.edgeId, leg.direction);
      if (!polyline) continue;
      for (const point of polyline) {
        const last = points[points.length - 1];
        if (!last || last.x !== point.x || last.z !== point.z) points.push(point);
      }
    }
    if (points.length < 2) continue;
    const callsign = agent.callsign;
    lines.push({
      key: `route-${plan.planId}`,
      agentId: plan.agentId,
      callsign,
      phase: plan.phase,
      points,
      selected: plan.agentId === selectedAgentId,
      label: `${callsign} ${PHASE_WORD[plan.phase]}`,
      limitingReason: plan.limitingReason,
    });
  }
  return lines;
}

export type ForecastReliability = "reliable" | "unreliable" | "rebuilding";

export interface ForecastBand {
  readonly key: string;
  readonly edgeId: string;
  readonly points: SceneVector[];
  readonly earliestMs: number | null;
  readonly latestMs: number | null;
  /** Full modeled uncertainty before clipping the display window; null when either end is unmodeled. */
  readonly spreadMs: number | null;
  /** Scene-unit ribbon half-width. Wider = less certain arrival time. */
  readonly widthUnits: number;
  /** Simulated-time text, e.g. "fire may reach 10:00–15:00 (simulated time)". */
  readonly label: string;
}

export interface ForecastLayer {
  readonly reliability: ForecastReliability;
  readonly supportedMemberCount: number;
  readonly explanation: string | null;
  readonly bands: ForecastBand[];
  /** Whether the envelope may be trusted for display emphasis. */
  readonly trusted: boolean;
  readonly headline: string;
}

const MIN_BAND_WIDTH = 6;
const MAX_BAND_WIDTH = 16;
/** Spread at which the ribbon reaches MAX_BAND_WIDTH. */
const FULL_UNCERTAINTY_MS = 300_000;

export function bandWidthForSpread(spreadMs: number | null): number {
  if (spreadMs === null) return MIN_BAND_WIDTH;
  const t = Math.min(1, Math.max(0, spreadMs / FULL_UNCERTAINTY_MS));
  return MIN_BAND_WIDTH + (MAX_BAND_WIDTH - MIN_BAND_WIDTH) * t;
}

function bandLabel(earliest: number | null, latest: number | null, simTimeMs: number): string {
  if (earliest === null && latest === null) return "no modeled fire arrival";
  if (earliest === null || latest === null) {
    const only = (earliest ?? latest) as number;
    return `fire may reach ${formatIncidentClock(only)} (simulated time, partial)`;
  }
  if (latest <= simTimeMs) return `modeled fire arrival already passed (${formatIncidentClock(latest)})`;
  if (earliest === latest) return `fire may reach ${formatIncidentClock(earliest)} (simulated time)`;
  return `fire may reach ${formatIncidentClock(earliest)}–${formatIncidentClock(latest)} (simulated time)`;
}

const HEADLINE: Record<ForecastReliability, (members: number) => string> = {
  reliable: (members) => `Forecast reliable (${members} supported scenarios)`,
  unreliable: () => "Forecast unreliable: treat bands as unknown",
  rebuilding: () => "Forecast rebuilding: bands may change",
};

/** Null before the first forecast build and after the incident finishes. */
export function buildForecastLayer(view: CoordinatorView, map: ScenarioMap): ForecastLayer | null {
  const forecast = view.coordinatorForecast;
  if (!forecast || view.incidentEnd !== null || view.simTimeMs >= INCIDENT_SIM_HORIZON_MS) return null;
  const simTimeMs = view.simTimeMs as number;
  const bands: ForecastBand[] = [];
  for (const arrival of forecast.edgeArrivals) {
    const points = resolveEdgePolyline(map, arrival.edgeId, "forward");
    if (!points) continue;
    const rawEarliest = arrival.earliestIgnitionMs as number | null;
    const rawLatest = arrival.latestIgnitionMs as number | null;
    // Do not turn an arrival after the incident into a prediction at its end.
    if (rawEarliest !== null && rawEarliest >= INCIDENT_SIM_HORIZON_MS) continue;
    if (rawEarliest === null && rawLatest !== null && rawLatest >= INCIDENT_SIM_HORIZON_MS) continue;
    const earliest = rawEarliest;
    const latest = rawLatest === null ? null : Math.min(rawLatest, INCIDENT_SIM_HORIZON_MS);
    const clipped = rawLatest !== null && rawLatest > INCIDENT_SIM_HORIZON_MS;
    // Keep the original uncertainty for the ribbon, even when its text window is clipped.
    const spread = rawEarliest !== null && rawLatest !== null ? Math.max(0, rawLatest - rawEarliest) : null;
    bands.push({
      key: `forecast-${arrival.edgeId}`,
      edgeId: arrival.edgeId,
      points,
      earliestMs: earliest,
      latestMs: latest,
      spreadMs: spread,
      widthUnits: bandWidthForSpread(spread),
      label: bandLabel(earliest, latest, simTimeMs) + (clipped ? "; window continues beyond incident" : ""),
    });
  }
  return {
    reliability: forecast.reliability,
    supportedMemberCount: forecast.supportedMemberCount,
    explanation: forecast.explanation,
    bands,
    trusted: forecast.reliability === "reliable",
    headline: HEADLINE[forecast.reliability](forecast.supportedMemberCount),
  };
}

/** Midpoint of a polyline by index, for label anchoring. */
export function polylineMidpoint(points: readonly SceneVector[]): SceneVector {
  const a = points[0] ?? { x: 0, z: 0 };
  const b = points[points.length - 1] ?? a;
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

/** At most this many forecast bands get a text label; the rest stay as hatching (the real server sends one per road). */
export const MAX_FORECAST_LABELS = 3;

/**
 * The bands worth a label: those where fire could arrive soonest (nulls last), up to the cap.
 * A map with ten overlapping window labels is unreadable, and the nearest threats matter most.
 */
export function labelledBands(bands: readonly ForecastBand[], max = MAX_FORECAST_LABELS): ForecastBand[] {
  const key = (band: ForecastBand) => band.earliestMs ?? band.latestMs ?? Number.POSITIVE_INFINITY;
  return [...bands].sort((a, b) => key(a) - key(b)).slice(0, max);
}

export function humanizeReason(reason: string): string {
  return limitingReasonDisplayText(reason);
}
