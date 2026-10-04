import type { CoordinatorView } from "@ember/domain";
import type { ScenarioMap } from "../../map/scenarioMap.js";
import { resolveEdgePolyline, type SceneVector } from "../../map/positions.js";
import { worldToScene } from "../../map/worldScale.js";
import { limitingReasonDisplayText } from "../../format/limitingReason.js";
import { formatIncidentClock } from "../../format/time.js";

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
  /** False for the extra pieces of a plan whose route does not form one continuous line. */
  readonly labelled?: boolean;
}

const PHASE_WORD: Record<RoutePhase, string> = {
  approach: "approaching",
  work: "working",
  return: "returning",
};

/** Scene units within which two path ends count as the same place. */
const JOIN_TOLERANCE = 1;

function samePlace(a: SceneVector, b: SceneVector): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) <= JOIN_TOLERANCE;
}

function appendPoints(points: SceneVector[], next: readonly SceneVector[]): void {
  for (const point of next) {
    const last = points[points.length - 1];
    if (!last || last.x !== point.x || last.z !== point.z) points.push(point);
  }
}

/**
 * Joins path pieces whose ends meet into continuous polylines. Pieces that do not meet stay
 * separate, so no connection is ever drawn that the plan does not report.
 */
function joinPieces(pieces: readonly SceneVector[][]): SceneVector[][] {
  const joined: SceneVector[][] = [];
  for (const piece of pieces) {
    if (piece.length < 2) continue;
    const before = joined.find((line) => samePlace(line[line.length - 1]!, piece[0]!));
    if (before !== undefined) {
      appendPoints(before, piece.slice(1));
      continue;
    }
    const after = joined.find((line) => samePlace(piece[piece.length - 1]!, line[0]!));
    if (after !== undefined) {
      after.splice(0, 1, ...piece);
      continue;
    }
    joined.push([...piece]);
  }
  return joined;
}

/** Road legs in travel order, then off-road legs in departure order, each as scene polylines. */
function planPieces(plan: CoordinatorView["agentPlans"][number], map: ScenarioMap): SceneVector[][] {
  const road: SceneVector[] = [];
  for (const leg of plan.legs) {
    const polyline = resolveEdgePolyline(map, leg.edgeId, leg.direction);
    if (!polyline) continue;
    appendPoints(road, polyline);
  }
  const offroad = [...(plan.offroadLegs ?? [])]
    .sort((a, b) => a.departMs - b.departMs)
    .map((leg) => [worldToScene(leg.start.x, leg.start.y, map.worldMeters), worldToScene(leg.end.x, leg.end.y, map.worldMeters)]);
  return [road, ...offroad];
}

function workSuffix(plan: CoordinatorView["agentPlans"][number]): string {
  if (plan.work === undefined) return "";
  return plan.work.kind === "suppress_fire" ? " (fire suppression)" : " (structure protection)";
}

/**
 * RouteLines per reportable plan. Road legs and off-road legs are joined where their ends meet;
 * a leg whose edge is unknown to the map is skipped (never drawn at a fallback position). Only
 * the first line of a plan is labelled, so a split route still reads as one plan.
 */
export function buildRouteLines(
  view: CoordinatorView,
  map: ScenarioMap,
  selectedAgentId: string | null,
): RouteLine[] {
  const lines: RouteLine[] = [];
  for (const plan of view.agentPlans) {
    const paths = joinPieces(planPieces(plan, map));
    if (paths.length === 0) continue;
    const agent = view.agents.find((candidate) => candidate.id === plan.agentId);
    const callsign = agent?.callsign ?? plan.agentId;
    paths.forEach((points, index) => {
      lines.push({
        key: index === 0 ? `route-${plan.planId}` : `route-${plan.planId}-${index}`,
        agentId: plan.agentId,
        callsign,
        phase: plan.phase,
        points,
        selected: plan.agentId === selectedAgentId,
        label: `${callsign} ${PHASE_WORD[plan.phase]}${workSuffix(plan)}`,
        limitingReason: plan.limitingReason,
        labelled: index === 0,
      });
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
  /** latest - earliest: the uncertainty the ribbon width encodes; null when either end is unmodeled. */
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

/** Null before the coordinator's first forecast build. */
export function buildForecastLayer(view: CoordinatorView, map: ScenarioMap): ForecastLayer | null {
  const forecast = view.coordinatorForecast;
  if (!forecast) return null;
  const simTimeMs = view.simTimeMs as number;
  const bands: ForecastBand[] = [];
  for (const arrival of forecast.edgeArrivals) {
    const points = resolveEdgePolyline(map, arrival.edgeId, "forward");
    if (!points) continue;
    const earliest = arrival.earliestIgnitionMs as number | null;
    const latest = arrival.latestIgnitionMs as number | null;
    const spread = earliest !== null && latest !== null ? Math.max(0, latest - earliest) : null;
    bands.push({
      key: `forecast-${arrival.edgeId}`,
      edgeId: arrival.edgeId,
      points,
      earliestMs: earliest,
      latestMs: latest,
      spreadMs: spread,
      widthUnits: bandWidthForSpread(spread),
      label: bandLabel(earliest, latest, simTimeMs),
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
