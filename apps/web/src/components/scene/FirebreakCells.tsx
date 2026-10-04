import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Color, Object3D, type CanvasTexture, type InstancedMesh } from "three";
import type { ClearingMarker, FirebreakMarker } from "./sceneEntities.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { createCrosshatchTexture } from "./patternTextures.js";
import { colors } from "../../styles/colors.js";

/** Below the ember beds (FireCells.tsx lifts those 1.2), so a fire tile beside a break stays on top. */
const LIFT = 0.6;
const THICKNESS = 1;
/** A cell being cleared starts at this share of a full tile and grows with its clearance. */
const CLEARING_MIN_SCALE = 0.4;
/** An ordered but unstarted line cell is a small marker, like a flagged stake. */
const PLANNED_SCALE = 0.22;

/**
 * Firebreaks and fire-line work. Shape carries the state, not colour alone:
 * - finished firebreak: full crosshatched tile (tiles touch, so a line reads as one band);
 * - being cleared: crosshatched tile that grows with clearance;
 * - ordered, not started: small pale marker.
 */
export function FirebreakCells({
  cells,
  clearing = [],
  planned = [],
}: {
  readonly cells: readonly FirebreakMarker[];
  readonly clearing?: readonly ClearingMarker[];
  readonly planned?: readonly FirebreakMarker[];
}) {
  const texture = useMemo(() => createCrosshatchTexture(colors.firebreak, colors.firebreakHatch), []);
  useEffect(() => () => texture.dispose(), [texture]);
  const clearingScales = useMemo(() => clearing.map((cell) => CLEARING_MIN_SCALE + (1 - CLEARING_MIN_SCALE) * cell.clearance), [clearing]);
  return (
    <>
      <Tiles cells={cells} texture={texture} />
      <Tiles cells={clearing} scales={clearingScales} texture={texture} />
      <Tiles cells={planned} scales={planned.map(() => PLANNED_SCALE)} lift={1.4} />
    </>
  );
}

function Tiles({
  cells,
  scales,
  texture,
  lift = 1,
}: {
  readonly cells: readonly FirebreakMarker[];
  /** Per-cell footprint as a share of a full tile; full tiles when omitted. */
  readonly scales?: readonly number[];
  /** Crosshatch; a plain pale tile when omitted. */
  readonly texture?: CanvasTexture;
  readonly lift?: number;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const invalidate = useThree((state) => state.invalidate);
  const size = sceneTerrain.cellSize * 0.98;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    cells.forEach((cell, index) => {
      const ground = sceneTerrain.groundY(cell.position.x, cell.position.z);
      const s = scales?.[index] ?? 1;
      dummy.position.set(cell.position.x, ground + LIFT * lift, cell.position.z);
      dummy.scale.set(s, lift, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // frameloop="demand": direct mesh mutation needs an explicit frame.
    invalidate();
  }, [cells, scales, dummy, invalidate, lift]);

  if (cells.length === 0) return null;
  return (
    <instancedMesh key={cells.length} ref={meshRef} args={[undefined, undefined, cells.length]} frustumCulled={false} receiveShadow>
      <boxGeometry args={[size, THICKNESS, size]} />
      {texture === undefined ? (
        <meshStandardMaterial color={new Color(colors.firebreak)} roughness={1} emissive={new Color(colors.firebreak)} emissiveIntensity={0.35} />
      ) : (
        <meshStandardMaterial map={texture} roughness={1} emissive={new Color(colors.firebreak)} emissiveIntensity={0.12} />
      )}
    </instancedMesh>
  );
}
