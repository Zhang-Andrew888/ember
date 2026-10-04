import { Vector3, type Camera } from "three";

/** Clockwise screen angle of world north (+z), measured from the top of the map. */
export function northBearing(camera: Camera): number {
  const center = new Vector3(0, 0, 0).project(camera);
  const north = new Vector3(0, 0, 1).project(camera);
  return Math.atan2(north.x - center.x, north.y - center.y);
}
