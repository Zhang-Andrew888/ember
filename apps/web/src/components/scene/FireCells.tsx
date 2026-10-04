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
 * "Ember beds": one flat tile per fire cell, the inspectable, always-visible record of the fire
 * (click to inspect), so a cell's state never depends on the flame animation or on colour alone.
 *
 * Three kinds stay visually distinct (#114):
 * - current fire (the live coordinator feed, full map): solid tiles - burning = raised orange,
 *   burned = flat dark;
 * - observed belief (crew sightings, possibly old): an outlined FRAME, never a solid tile, once a
 *   current-fire layer exists. Without one (older sender) observations are drawn as before:
 *   burning = raised solid tile, stale = outlined ghost tile, burned = flat dark tile;
 * - replay-only unseen truth: a dashed violet frame.
 * Pulsing was removed: the flame shader carries all motion now.
 */
export function FireCells({
  current,
  currentFirePresent,
  cells,
  onInspectCell,
}: {
  /** Current-fire cells to draw (empty when hidden or absent). */
  readonly current: FireCellMarker[];
  /** True when the view carries a current-fire layer, even an empty one: observations are then beliefs. */
  readonly currentFirePresent: boolean;
  /** Observed cells (and replay-only unseen truth cells). */
  readonly cells: FireCellMarker[];
  readonly onInspectCell: (cell: FireCellMarker) => void;
}) {
  const currentBurning = useMemo(() => current.filter((c) => c.burnState === "burning"), [current]);
  const currentBurned = useMemo(() => current.filter((c) => c.burnState === "burned"), [current]);
  const unseen = useMemo(() => cells.filter((c) => c.unseen), [cells]);
  const known = useMemo(() => cells.filter((c) => !c.unseen), [cells]);
  const belief = useMemo(
    () => (currentFirePresent ? known.filter((c) => c.burnState !== "unburned") : []),
    [known, currentFirePresent],
  );
  const beliefFresh = useMemo(() => belief.filter((c) => !c.stale), [belief]);
  const beliefStale = useMemo(() => belief.filter((c) => c.stale), [belief]);
  const legacy = useMemo(() => (currentFirePresent ? [] : known), [known, currentFirePresent]);
  const fresh = useMemo(() => legacy.filter((c) => c.burnState === "burning" && !c.stale), [legacy]);
  const stale = useMemo(() => legacy.filter((c) => c.stale && c.burnState !== "unburned"), [legacy]);
  const burned = useMemo(() => legacy.filter((c) => c.burnState === "burned" && !c.stale), [legacy]);

  return (
    <>
      <BedGroup cells={currentBurning} color={colors.observedFire} opacity={0.9} lift={1} onInspectCell={onInspectCell} />
      <BedGroup cells={currentBurned} color="#1c1714" opacity={0.95} lift={0.2} onInspectCell={onInspectCell} />
      {/* Observed belief next to a current-fire layer: outlined frames (fresh = light, stale = grey), never solid. */}
      <BedGroup cells={beliefFresh} color={colors.observedBelief} opacity={1} lift={0.5} wire onInspectCell={onInspectCell} />
      <BedGroup cells={beliefStale} color={colors.staleOutline} opacity={0.7} lift={0.5} wire onInspectCell={onInspectCell} />
      <BedGroup cells={fresh} color={colors.observedFire} opacity={0.9} lift={1} onInspectCell={onInspectCell} />
      <BedGroup cells={stale} color={colors.staleOutline} opacity={0.55} lift={0.4} onInspectCell={onInspectCell} />
      {/* REPLAY ONLY: real fire the coordinator never observed - dashed violet frame, not a solid tile. */}
      <BedGroup cells={unseen} color="#B79CFF" opacity={1} lift={0.3} wire onInspectCell={onInspectCell} />
      <BedGroup cells={burned} color="#1c1714" opacity={0.95} lift={0.2} onInspectCell={onInspectCell} />
    </>
  );
}

function BedGroup({
  cells,
  color,
  opacity,
  lift,
  wire = false,
  onInspectCell,
}: {
  readonly cells: FireCellMarker[];
  readonly color: string;
  readonly opacity: number;
  readonly lift: number;
  readonly wire?: boolean;
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
      <meshStandardMaterial wireframe={wire} color={new Color(color)} transparent={opacity < 1} opacity={opacity} emissive={new Color(color)} emissiveIntensity={opacity > 0.8 && color === colors.observedFire ? 0.8 : 0.1} />
    </instancedMesh>
  );
}
