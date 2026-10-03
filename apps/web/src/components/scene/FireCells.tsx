import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, Object3D, type InstancedMesh } from "three";
import type { FireCellMarker } from "./sceneEntities.js";
import { colors } from "../../styles/colors.js";

const CELL_SIZE = 14;
/** Box half-height is CELL_SIZE*0.6/2 (~4.2); must clear the terrain's max bump (~2.4). */
const CELL_Y = 9;

/**
 * Instanced fire cells (docs/FRONTEND.md recommends instancing for
 * repeated geometry such as fire cells). Fresh burning cells pulse gently
 * unless reduced motion is requested; stale observations render
 * desaturated so staleness is never conveyed only by an animation someone
 * could miss, and never looks identical to a live flame.
 */
export function FireCells({
  cells,
  reducedMotion,
}: {
  readonly cells: FireCellMarker[];
  readonly reducedMotion: boolean;
}) {
  const fresh = useMemo(
    () => cells.filter((c) => c.burnState === "burning" && !c.stale),
    [cells],
  );
  const stale = useMemo(() => cells.filter((c) => c.stale && c.burnState !== "unburned"), [cells]);

  return (
    <>
      <FireCellGroup cells={fresh} color={colors.observedFire} opacity={1} pulsing={!reducedMotion} />
      <FireCellGroup cells={stale} color={colors.staleOutline} opacity={0.5} pulsing={false} />
    </>
  );
}

function FireCellGroup({
  cells,
  color,
  opacity,
  pulsing,
}: {
  readonly cells: FireCellMarker[];
  readonly color: string;
  readonly opacity: number;
  readonly pulsing: boolean;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    cells.forEach((cell, index) => {
      dummy.position.set(cell.position.x, CELL_Y, cell.position.z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [cells, dummy]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || !pulsing || cells.length === 0) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 3) * 0.08;
    cells.forEach((cell, index) => {
      dummy.position.set(cell.position.x, CELL_Y, cell.position.z);
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (cells.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, cells.length]} frustumCulled={false}>
      <boxGeometry args={[CELL_SIZE, CELL_SIZE * 0.6, CELL_SIZE]} />
      <meshStandardMaterial color={new Color(color)} transparent opacity={opacity} />
    </instancedMesh>
  );
}
