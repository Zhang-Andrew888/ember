import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  TorusGeometry,
  Uint16BufferAttribute,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Rgb = readonly [number, number, number];

/** White vertex colour: takes the material colour (agent colour / site tint). */
export const PAINT: Rgb = [1, 1, 1];

export interface Part {
  readonly geometry: BufferGeometry;
  readonly color: Rgb;
}

/** Triangular prism along +x with a ridge at the top (pitched roof / A-frame). */
export function prism(length: number, width: number, height: number): BufferGeometry {
  const hx = length / 2;
  const hz = width / 2;
  // 6 vertices: left end (0,1,2), right end (3,4,5); each end is (front-bottom, back-bottom, ridge).
  const positions = new Float32Array([
    -hx, 0, -hz, -hx, 0, hz, -hx, height, 0,
    hx, 0, -hz, hx, 0, hz, hx, height, 0,
  ]);
  const indices = [
    0, 2, 1, // left cap
    3, 4, 5, // right cap
    0, 3, 5, 0, 5, 2, // back slope
    1, 2, 5, 1, 5, 4, // front slope
    0, 1, 4, 0, 4, 3, // floor
  ];
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setIndex(new Uint16BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.setAttribute("uv", new Float32BufferAttribute(new Float32Array(6 * 2), 2));
  return geo;
}

/** Box with its base at y = 0, centred in x/z, then moved to (x, y, z). */
export function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  const geo = new BoxGeometry(w, h, d);
  geo.translate(x, y + h / 2, z);
  return geo;
}

export function cylinder(radius: number, height: number, x: number, y: number, z: number, segments = 8): BufferGeometry {
  const geo = new CylinderGeometry(radius, radius, height, segments);
  geo.translate(x, y + height / 2, z);
  return geo;
}

export function cone(radius: number, height: number, x: number, y: number, z: number, segments = 4): BufferGeometry {
  const geo = new ConeGeometry(radius, height, segments);
  geo.translate(x, y + height / 2, z);
  return geo;
}

export function dome(radius: number, x: number, y: number, z: number): BufferGeometry {
  const geo = new SphereGeometry(radius, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.translate(x, y, z);
  return geo;
}

export function ring(radius: number, tube: number, y: number): BufferGeometry {
  const geo = new TorusGeometry(radius, tube, 4, 20);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

/** Colours every vertex and strips attributes the merge does not share. */
export function tinted(geometry: BufferGeometry, color: Rgb): BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set(color, i * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  if (!geometry.getAttribute("uv")) {
    geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(count * 2), 2));
  }
  return geometry;
}

/** Merges parts into one draw call (vertex colours carry the per-part colour). */
export function merge(parts: readonly Part[]): BufferGeometry {
  const merged = mergeGeometries(
    parts.map(({ geometry, color }) => {
      // Non-indexed and indexed geometry cannot be merged together; normalise to indexed.
      return tinted(geometry, color);
    }),
  );
  if (!merged) throw new Error("model geometry merge failed");
  merged.computeBoundingBox();
  return merged;
}
