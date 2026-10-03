import type { SceneVector } from "../../map/positions.js";

export interface RibbonGeometryData {
  readonly positions: Float32Array;
  /** u = distance along the line / tileLength (for repeating patterns), v = 0..1 across. */
  readonly uvs: Float32Array;
  readonly indices: Uint16Array;
}

/**
 * Flat ribbon (XZ plane at height y) along a polyline. Miter joins are
 * averaged from adjacent segment normals; a degenerate (zero-length)
 * polyline yields empty buffers.
 */
export function buildRibbonData(
  points: readonly SceneVector[],
  halfWidth: number,
  y: number,
  tileLength: number,
): RibbonGeometryData {
  if (points.length < 2) {
    return { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint16Array(0) };
  }
  const positions = new Float32Array(points.length * 6);
  const uvs = new Float32Array(points.length * 4);
  let distance = 0;
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const point = points[i]!;
    if (i > 0) distance += Math.hypot(point.x - prev.x, point.z - prev.z);
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    // Left-hand normal in the XZ plane.
    const nx = -dz;
    const nz = dx;
    positions.set([point.x + nx * halfWidth, y, point.z + nz * halfWidth], i * 6);
    positions.set([point.x - nx * halfWidth, y, point.z - nz * halfWidth], i * 6 + 3);
    uvs.set([distance / tileLength, 0, distance / tileLength, 1], i * 4);
  }
  const indices = new Uint16Array((points.length - 1) * 6);
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    indices.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6);
  }
  return { positions, uvs, indices };
}
