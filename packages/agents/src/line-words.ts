import type { CompassDirection, MapPoint } from "@ember/domain";

const COMPASS: readonly CompassDirection[] = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const OPPOSITE: Record<CompassDirection, CompassDirection> = {
  north: "south",
  northeast: "southwest",
  east: "west",
  southeast: "northwest",
  south: "north",
  southwest: "northeast",
  west: "east",
  northwest: "southeast",
};

/** Compass point (north = increasing map y) nearest the direction from `from` to `to`. */
function compassFrom(from: MapPoint, to: MapPoint): CompassDirection {
  const bearing = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
  const index = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index] ?? "north";
}

/**
 * Plain words for the two ends of a line as the crew at `own` sees them: its own end by compass
 * ("north end" is the end lying north of the other) and the far end as a named place when the caller
 * has one, else as the opposite compass end. Never raw ids or coordinates.
 */
export function lineEndWords(own: MapPoint, far: MapPoint, farPlaceName: string | null): { own: string; far: string } {
  const ownCompass = compassFrom(far, own);
  return {
    own: `the ${ownCompass} end`,
    far: farPlaceName ?? `the ${OPPOSITE[ownCompass]} end`,
  };
}
