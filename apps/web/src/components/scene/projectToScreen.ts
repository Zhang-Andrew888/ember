import type { Camera, Vector3 } from "three";

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** False once the point is behind the camera or outside its clip range. */
  readonly visible: boolean;
}

/**
 * Projects a world-space point to CSS pixel coordinates within a viewport of
 * the given size, for positioning DOM labels/tooltips over the Three.js
 * canvas (docs/FRONTEND.md scene layer 7). Pure/testable: takes primitive
 * numbers in, returns primitive numbers out, no DOM access.
 */
export function projectToScreen(
  camera: Camera,
  worldPosition: Vector3,
  viewportWidth: number,
  viewportHeight: number,
): ScreenPoint {
  const ndc = worldPosition.clone().project(camera);
  return {
    x: (ndc.x * 0.5 + 0.5) * viewportWidth,
    y: (-ndc.y * 0.5 + 0.5) * viewportHeight,
    visible: ndc.z > -1 && ndc.z < 1,
  };
}
