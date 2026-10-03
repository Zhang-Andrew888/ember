import { BoxGeometry, type BufferGeometry } from "three";
import { box, cone, cylinder, dome, merge, PAINT, prism, type Part, type Rgb } from "./geometry.js";
import type { SiteModelKind } from "./markerCues.js";

/**
 * Site silhouettes (scene units, base at y = 0): a cluster of three cabins,
 * a waterworks (tank, dome, pump house, pipe) and a long lodge with a pitched
 * roof and chimney. Each reads differently at a glance without colour.
 */
const WALL: Rgb = [0.82, 0.78, 0.7];
const ROOF: Rgb = [0.55, 0.3, 0.24];
const METAL: Rgb = [0.62, 0.7, 0.74];
const DARK: Rgb = [0.18, 0.17, 0.17];

function rotateY(geometry: BufferGeometry, angle: number): BufferGeometry {
  geometry.rotateY(angle);
  return geometry;
}

export function createCabinsGeometry(): BufferGeometry {
  const parts: Part[] = [];
  for (const [x, z, rot] of [[-13, -8, 0.2], [12, -6, -0.35], [0, 13, 0.1]] as const) {
    const wall = box(15, 9, 12, 0, 0, 0);
    const roof = prism(18, 15, 8);
    roof.translate(0, 9, 0);
    for (const [geometry, color] of [[wall, WALL], [roof, ROOF]] as const) {
      rotateY(geometry, rot);
      geometry.translate(x, 0, z);
      parts.push({ geometry, color: color === WALL ? PAINT : color });
    }
  }
  return merge(parts);
}

export function createWaterworksGeometry(): BufferGeometry {
  const parts: Part[] = [
    { geometry: cylinder(10, 16, -8, 0, 0, 12), color: PAINT },
    { geometry: dome(10, -8, 16, 0), color: METAL },
    { geometry: cylinder(1.4, 12, -8, 16, 0, 6), color: DARK }, // vent mast
    { geometry: box(16, 9, 14, 16, 0, -4), color: WALL },
    { geometry: prism(18, 15, 5), color: ROOF },
    { geometry: cylinder(1.8, 22, 0, 4, 12, 6), color: METAL }, // pipe run (upright stub)
  ];
  parts[4]!.geometry.translate(16, 9, -4);
  const pipe = new BoxGeometry(24, 2.4, 2.4);
  pipe.translate(2, 4, 10);
  parts.push({ geometry: pipe, color: METAL });
  return merge(parts);
}

export function createLodgeGeometry(): BufferGeometry {
  const roof = prism(38, 20, 11);
  roof.translate(0, 11, 0);
  return merge([
    { geometry: box(34, 11, 17, 0, 0, 0), color: PAINT },
    { geometry: roof, color: ROOF },
    { geometry: box(5, 14, 5, 10, 11, 4), color: DARK }, // chimney
    { geometry: box(8, 6, 3, 0, 0, 9.5), color: DARK }, // porch door block
    { geometry: cone(3, 6, 0, 11, 0, 4), color: DARK }, // cupola
  ]);
}

export function createSiteGeometry(kind: SiteModelKind): BufferGeometry {
  switch (kind) {
    case "cabins":
      return createCabinsGeometry();
    case "waterworks":
      return createWaterworksGeometry();
    case "lodge":
      return createLodgeGeometry();
  }
}

/** Fence-post ring (partial protection) at a given radius. */
export function createFenceRingGeometry(radius = 34, posts = 12): BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < posts; i++) {
    // Leave one gap in the ring: protection is underway, not complete.
    if (i === 0) continue;
    const angle = (i / posts) * Math.PI * 2;
    parts.push({ geometry: cylinder(1.2, 7, Math.cos(angle) * radius, 0, Math.sin(angle) * radius, 5), color: [0.9, 0.85, 0.6] });
  }
  return merge(parts);
}

export function createRubbleGeometry(): BufferGeometry {
  return merge([
    { geometry: box(26, 3, 20, 0, 0, 0), color: [0.12, 0.1, 0.09] },
    { geometry: box(10, 5, 8, -6, 3, 3), color: [0.16, 0.13, 0.11] },
    { geometry: box(8, 4, 6, 8, 3, -3), color: [0.14, 0.11, 0.1] },
  ]);
}

/** Damage gauge: 4 notch slots along z, filled count is applied by the marker (see markerCues.damageNotches). */
export function createDamageNotchGeometry(): BufferGeometry {
  return box(3, 6, 3.6, 0, 0, 0);
}
