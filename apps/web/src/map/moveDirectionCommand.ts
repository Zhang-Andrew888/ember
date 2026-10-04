import type { CompassDirection } from "@ember/domain";
import type { WorldPoint } from "./worldPoint.js";

export interface MapMovementDraft {
  readonly agentId: string;
  readonly callsign: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  readonly direction: CompassDirection;
  readonly distanceMeters: number;
  readonly commandText: string;
}

const COMPASS: readonly CompassDirection[] = [
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
  return COMPASS[index]!;
}

export function worldDistanceMeters(from: WorldPoint, to: WorldPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

const MIN_DISTANCE_M = 25;
const MAX_DISTANCE_M = 1200;
const DEFAULT_CAP_M = 600;

/**
 * Build the exact coordinator utterance for a directional movement objective.
 * Wording matches the domain contract (compass direction, bounded distance, safe road stop).
 */
export function buildMoveDirectionDraft(input: {
  readonly agentId: string;
  readonly callsign: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
}): MapMovementDraft | null {
  const raw = worldDistanceMeters(input.from, input.to);
  if (raw < MIN_DISTANCE_M) return null;
  const capped = Math.min(raw, MAX_DISTANCE_M);
  const direction = bearingToCompass(input.to.x - input.from.x, input.to.y - input.from.y);
  const travelM = Math.round(capped);
  const distancePhrase = travelM > DEFAULT_CAP_M ? ` up to ${travelM} meters` : "";
  const commandText = `${input.callsign}, move ${direction}${distancePhrase} and stop at the nearest safe road.`;
  return {
    agentId: input.agentId,
    callsign: input.callsign,
    from: input.from,
    to: input.to,
    direction,
    distanceMeters: travelM,
    commandText,
  };
}
