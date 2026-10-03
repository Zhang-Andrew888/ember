import { useMemo } from "react";
import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import { colors } from "../../styles/colors.js";

const SIZE = 1400;
const SEGMENTS = 28;

/**
 * Low-poly ground plane with gentle procedural elevation bands, vertex-
 * colored between sage and ochre (docs/FRONTEND.md). No textures/assets,
 * so the demo scene has no external asset dependency.
 */
export function Terrain() {
  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    const verticesPerSide = SEGMENTS + 1;
    const positions: number[] = [];
    const colorValues: number[] = [];
    const sage = new Color(colors.terrainSage);
    const ochre = new Color(colors.terrainOchre);

    for (let iz = 0; iz < verticesPerSide; iz++) {
      for (let ix = 0; ix < verticesPerSide; ix++) {
        const x = (ix / SEGMENTS - 0.5) * SIZE;
        const z = (iz / SEGMENTS - 0.5) * SIZE;
        // Kept subtle (max ~2.4) - markers/roads/fire cells sit at fixed
        // heights above this and must always clear it (found via a
        // Playwright smoke check: fire cells were sinking into taller bumps).
        const elevation =
          (Math.sin(x / 260) * 10 + Math.cos(z / 300) * 8 + Math.sin((x + z) / 180) * 6) * 0.1;
        positions.push(x, elevation, z);

        const t = Math.max(0, Math.min(1, (elevation + 2.4) / 4.8));
        const mixed = sage.clone().lerp(ochre, t);
        colorValues.push(mixed.r, mixed.g, mixed.b);
      }
    }

    const indices: number[] = [];
    for (let iz = 0; iz < SEGMENTS; iz++) {
      for (let ix = 0; ix < SEGMENTS; ix++) {
        const a = iz * verticesPerSide + ix;
        const b = a + 1;
        const c = a + verticesPerSide;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    geo.setIndex(indices);
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new Float32BufferAttribute(colorValues, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} receiveShadow rotation={[0, 0, 0]}>
      <meshStandardMaterial vertexColors flatShading roughness={1} metalness={0} />
    </mesh>
  );
}
