import { BoxGeometry, ConeGeometry, CylinderGeometry, type BufferGeometry } from "three";
import { box, cone, cylinder, merge, PAINT, type Part, type Rgb } from "./geometry.js";

/**
 * Crew silhouette, in scene units, facing +x, base at y = 0.
 * A crew is a truck (long body, cab, bed, wheels) carrying 1..5 tally pegs on
 * its bed = the crew number.
 */
const DARK: Rgb = [0.1, 0.1, 0.11];
const GLASS: Rgb = [0.72, 0.86, 1.0];
const LIGHT: Rgb = [1, 0.85, 0.35];
const PEG: Rgb = [0.96, 0.96, 0.9];

export function createCrewGeometry(crewNumber: number): BufferGeometry {
  const parts: Part[] = [
    { geometry: box(34, 6, 15, 0, 4, 0), color: PAINT }, // chassis
    { geometry: box(12, 8, 15, 11, 10, 0), color: PAINT }, // cab
    { geometry: box(7, 4, 13.5, 12.5, 14, 0), color: GLASS }, // windscreen band
    { geometry: box(18, 4, 14, -8, 10, 0), color: PAINT }, // bed
    { geometry: box(5, 2, 10, 11, 18, 0), color: LIGHT }, // light bar
  ];
  for (const [x, z] of [[-9, 8], [-9, -8], [10, 8], [10, -8]] as const) {
    const wheel = new CylinderGeometry(3.4, 3.4, 3, 8);
    wheel.rotateX(Math.PI / 2);
    wheel.translate(x, 3.4, z);
    parts.push({ geometry: wheel, color: DARK });
  }
  // Tally pegs along the bed: the number of pegs is the crew number.
  const n = Math.min(5, Math.max(1, Math.round(crewNumber)));
  const spacing = 3.2;
  for (let i = 0; i < n; i++) {
    const z = (i - (n - 1) / 2) * spacing;
    parts.push({ geometry: cylinder(1.1, 7, -8, 14, z, 6), color: PEG });
  }
  return merge(parts);
}

/** Glyph geometries (placed by AgentMarkers relative to the model). */
export function createChevronGeometry(): BufferGeometry {
  const a = new ConeGeometry(4.5, 9, 3);
  a.rotateZ(-Math.PI / 2); // tip toward +x
  a.translate(0, 1.5, 0);
  return a;
}

export function createWarnGeometry(): BufferGeometry {
  // Warning triangle plate with a bar: one merged geometry.
  const plate = new ConeGeometry(8, 2, 3);
  plate.rotateX(Math.PI / 2);
  plate.translate(0, 26, 0);
  return merge([
    { geometry: plate, color: [1, 0.78, 0.2] },
    { geometry: box(1.6, 6, 1.6, 0, 24, 1.4), color: DARK },
    { geometry: cone(1, 1.6, 0, 22.2, 1.4, 6), color: DARK },
  ]);
}

export function createCrossGeometry(): BufferGeometry {
  const a = new BoxGeometry(16, 3, 3);
  a.rotateZ(Math.PI / 4);
  a.translate(0, 24, 0);
  const b = new BoxGeometry(16, 3, 3);
  b.rotateZ(-Math.PI / 4);
  b.translate(0, 24, 0);
  return merge([
    { geometry: a, color: [0.85, 0.3, 0.27] },
    { geometry: b, color: [0.85, 0.3, 0.27] },
  ]);
}

/** Open work ring with spokes (working). Radius is tuned to sit around a truck. */
export function createWorkGlyphGeometry(): BufferGeometry {
  const parts: Part[] = [];
  const outer = new CylinderGeometry(22, 22, 1.2, 24, 1, true);
  outer.translate(0, 1, 0);
  parts.push({ geometry: outer, color: PAINT });
  for (let i = 0; i < 4; i++) {
    const spoke = new BoxGeometry(14, 1.2, 2.4);
    spoke.translate(15, 1, 0);
    spoke.rotateY((i * Math.PI) / 2);
    parts.push({ geometry: spoke, color: PAINT });
  }
  return merge(parts);
}
