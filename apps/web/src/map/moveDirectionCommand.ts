import type { CompassDirection } from "@ember/domain";
import type { WorldPoint } from "./worldPoint.js";

export interface MapMovementDraft {
  readonly agentId: string;
  readonly callsign: string;
  readonly from: WorldPoint;
  /** Point the coordinator picked on the map, or the cue end for a keyboard draft. Not a destination. */
  readonly to: WorldPoint;
  readonly direction: CompassDirection;
  /** Distance to the picked point; null when the draft was built from a direction choice. */
  readonly pickedDistanceMeters: number | null;
  /** Farthest the order allows the crew to travel: the stated limit, or the default when none is stated. */
  readonly capMeters: number;
  /** Whether `capMeters` is stated in the command text (otherwise the default limit applies). */
  readonly capStated: boolean;
  /** End of the on-map direction cue: `from` moved `capMeters` along `direction`. */
  readonly cueTo: WorldPoint;
  readonly commandText: string;
}

export const COMPASS_DIRECTIONS: readonly CompassDirection[] = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
];

/** Map delta (east, north) to the nearest compass sector (world y is north). */
export function bearingToCompass(dx: number, dy: number): CompassDirection {
  const angleDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
  const normalized = ((angleDeg % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return COMPASS_DIRECTIONS[index]!;
}

/** Unit vector (east, north) for a compass sector. */
export function compassUnit(direction: CompassDirection): WorldPoint {
  const index = COMPASS_DIRECTIONS.indexOf(direction);
  const radians = (index * 45 * Math.PI) / 180;
  return { x: Math.sin(radians), y: Math.cos(radians) };
}

export function worldDistanceMeters(from: WorldPoint, to: WorldPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

const MIN_DISTANCE_M = 25;
export const MAX_TRAVEL_M = 1200;
/** Travel limit the order implies when the command text names no distance. */
export const DEFAULT_TRAVEL_CAP_M = 600;
/** Limits offered when drafting by keyboard; the default needs no distance in the command. */
export const TRAVEL_CAP_CHOICES_M: readonly number[] = [DEFAULT_TRAVEL_CAP_M, 900, MAX_TRAVEL_M];

function clampToMap(point: WorldPoint, worldMeters: number | undefined): WorldPoint {
  if (worldMeters === undefined) return point;
  const clamp = (value: number) => Math.min(worldMeters, Math.max(0, value));
  return { x: clamp(point.x), y: clamp(point.y) };
}

function draftFor(input: {
  readonly agentId: string;
  readonly callsign: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint | null;
  readonly direction: CompassDirection;
  readonly requestedMeters: number;
  readonly pickedDistanceMeters: number | null;
  readonly worldMeters?: number;
}): MapMovementDraft {
  const travelM = Math.round(Math.min(input.requestedMeters, MAX_TRAVEL_M));
  const capStated = travelM > DEFAULT_TRAVEL_CAP_M;
  const capMeters = capStated ? travelM : DEFAULT_TRAVEL_CAP_M;
  const unit = compassUnit(input.direction);
  const cueTo = clampToMap(
    { x: input.from.x + unit.x * capMeters, y: input.from.y + unit.y * capMeters },
    input.worldMeters,
  );
  const distancePhrase = capStated ? ` up to ${travelM} meters` : "";
  return {
    agentId: input.agentId,
    callsign: input.callsign,
    from: input.from,
    to: input.to ?? cueTo,
    direction: input.direction,
    pickedDistanceMeters: input.pickedDistanceMeters,
    capMeters,
    capStated,
    cueTo,
    commandText: `${input.callsign}, move ${input.direction}${distancePhrase} and stop at the nearest safe road.`,
  };
}

/**
 * Build the exact coordinator utterance for a directional movement objective from a map pick.
 * Wording matches the domain contract (compass direction, bounded distance, safe road stop): the
 * pick supplies a direction and, past the default limit, a distance limit, never an exact destination.
 */
export function buildMoveDirectionDraft(input: {
  readonly agentId: string;
  readonly callsign: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  readonly worldMeters?: number;
}): MapMovementDraft | null {
  const raw = worldDistanceMeters(input.from, input.to);
  if (raw < MIN_DISTANCE_M) return null;
  return draftFor({
    ...input,
    direction: bearingToCompass(input.to.x - input.from.x, input.to.y - input.from.y),
    requestedMeters: raw,
    pickedDistanceMeters: Math.round(raw),
  });
}

/** Keyboard equivalent of a map pick: same command semantics, chosen as direction and limit. */
export function buildDirectionalDraft(input: {
  readonly agentId: string;
  readonly callsign: string;
  readonly from: WorldPoint;
  readonly direction: CompassDirection;
  readonly capMeters: number;
  readonly worldMeters?: number;
}): MapMovementDraft {
  return draftFor({ ...input, to: null, requestedMeters: input.capMeters, pickedDistanceMeters: null });
}
