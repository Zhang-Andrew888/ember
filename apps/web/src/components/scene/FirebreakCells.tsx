import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Color, Object3D, type InstancedMesh } from "three";
import type { FirebreakMarker } from "./sceneEntities.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { createCrosshatchTexture } from "./patternTextures.js";
import { colors } from "../../styles/colors.js";

/** Below the ember beds (FireCells.tsx lifts those 1.2), so a fire tile beside a break stays on top. */
const LIFT = 0.6;
const THICKNESS = 1;

/**
 * Firebreaks: one flat, crosshatched tile per cleared cell. Tiles fill the whole cell (fire beds
 * leave gaps), so a line of them reads as one continuous band. The crosshatch carries the meaning,
 * not the colour alone.
 */
export function FirebreakCells({ cells }: { readonly cells: readonly FirebreakMarker[] }) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const invalidate = useThree((state) => state.invalidate);
  const texture = useMemo(() => createCrosshatchTexture(colors.firebreak, colors.firebreakHatch), []);
  useEffect(() => () => texture.dispose(), [texture]);
  const size = sceneTerrain.cellSize * 0.98;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    cells.forEach((cell, index) => {
      const ground = sceneTerrain.groundY(cell.position.x, cell.position.z);
      dummy.position.set(cell.position.x, ground + LIFT, cell.position.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // frameloop="demand": direct mesh mutation needs an explicit frame.
    invalidate();
  }, [cells, dummy, invalidate]);

  if (cells.length === 0) return null;
  return (
    <instancedMesh key={cells.length} ref={meshRef} args={[undefined, undefined, cells.length]} frustumCulled={false} receiveShadow>
      <boxGeometry args={[size, THICKNESS, size]} />
      <meshStandardMaterial map={texture} roughness={1} emissive={new Color(colors.firebreak)} emissiveIntensity={0.12} />
    </instancedMesh>
  );
}
