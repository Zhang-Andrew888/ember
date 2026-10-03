import { useLayoutEffect, useMemo, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Color, Object3D, type InstancedMesh } from "three";
import type { FireCellMarker } from "./sceneEntities.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { colors } from "../../styles/colors.js";

/** Flat tiles sit just above the ground; flames (Fire.tsx) rise from them. */
const BED_LIFT = 1.2;
const BED_THICKNESS = 1.6;

/**
 * Observed-cell "ember beds": one flat tile per cell that has been seen
 * burning or burned. They are the inspectable, always-visible record of an
 * observation (click to inspect; also listed in the legend), so a cell's
 * state never depends on the flame animation or on colour alone: burning =
 * raised solid tile, stale = outlined ghost tile (rendered by the same
 * instancing, thinner and desaturated), burned = flat dark tile.
 * Pulsing was removed: the flame shader carries all motion now.
 */
export function FireCells({
  cells,
  onInspectCell,
}: {
  readonly cells: FireCellMarker[];
  readonly onInspectCell: (cell: FireCellMarker) => void;
}) {
  const fresh = useMemo(() => cells.filter((c) => c.burnState === "burning" && !c.stale), [cells]);
  const stale = useMemo(() => cells.filter((c) => c.stale && c.burnState !== "unburned"), [cells]);
  const burned = useMemo(() => cells.filter((c) => c.burnState === "burned" && !c.stale), [cells]);

  return (
    <>
      <BedGroup cells={fresh} color={colors.observedFire} opacity={0.9} lift={1} onInspectCell={onInspectCell} />
      <BedGroup cells={stale} color={colors.staleOutline} opacity={0.55} lift={0.4} onInspectCell={onInspectCell} />
      <BedGroup cells={burned} color="#1c1714" opacity={0.95} lift={0.2} onInspectCell={onInspectCell} />
    </>
  );
}

function BedGroup({
  cells,
  color,
  opacity,
  lift,
  onInspectCell,
}: {
  readonly cells: FireCellMarker[];
  readonly color: string;
  readonly opacity: number;
  readonly lift: number;
  readonly onInspectCell: (cell: FireCellMarker) => void;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const invalidate = useThree((state) => state.invalidate);
  const size = sceneTerrain.cellSize * 0.8;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    cells.forEach((cell, index) => {
      const ground = sceneTerrain.groundY(cell.position.x, cell.position.z);
      dummy.position.set(cell.position.x, ground + BED_LIFT, cell.position.z);
      dummy.scale.set(1, lift, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Canvas uses frameloop="demand"; mutating the mesh directly bypasses
    // R3F's reconciler, so request the frame ourselves.
    invalidate();
  }, [cells, dummy, invalidate, lift]);

  if (cells.length === 0) return null;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const cell = event.instanceId === undefined ? undefined : cells[event.instanceId];
    if (cell) onInspectCell(cell);
  };

  return (
    <instancedMesh key={cells.length} ref={meshRef} args={[undefined, undefined, cells.length]} frustumCulled={false} onClick={handleClick}>
      <boxGeometry args={[size, BED_THICKNESS, size]} />
      <meshStandardMaterial color={new Color(color)} transparent={opacity < 1} opacity={opacity} emissive={new Color(color)} emissiveIntensity={opacity > 0.8 && color === colors.observedFire ? 0.8 : 0.1} />
    </instancedMesh>
  );
}
