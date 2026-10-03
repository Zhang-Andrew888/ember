import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Color, Object3D, type InstancedMesh } from "three";
import type { FireCellMarker } from "./sceneEntities.js";
import { colors } from "../../styles/colors.js";

const CELL_SIZE = 14;
/** Box half-height is CELL_SIZE*0.6/2 (~4.2); must clear the terrain's max bump (~2.4). */
const CELL_Y = 9;
/**
 * Minimum ms between pulse updates. Measured live (Playwright + a
 * WebGL draw-call counter): an every-frame pulse kept frameloop="demand"
 * rendering continuously - ~1000 draw calls over an idle 3s window,
 * dropping to ~60 with the pulse off entirely. Throttling instead of
 * removing it keeps docs/FRONTEND.md's "compact animated flame clusters"
 * while cutting the invalidation rate ~9x (60fps -> ~6-7fps for this
 * animation specifically; still reads as a visible, gentle pulse).
 */
const PULSE_INTERVAL_MS = 150;

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
  onInspectCell,
}: {
  readonly cells: FireCellMarker[];
  readonly reducedMotion: boolean;
  readonly onInspectCell: (cell: FireCellMarker) => void;
}) {
  const fresh = useMemo(
    () => cells.filter((c) => c.burnState === "burning" && !c.stale),
    [cells],
  );
  const stale = useMemo(() => cells.filter((c) => c.stale && c.burnState !== "unburned"), [cells]);

  return (
    <>
      <FireCellGroup
        cells={fresh}
        color={colors.observedFire}
        opacity={1}
        pulsing={!reducedMotion}
        onInspectCell={onInspectCell}
      />
      <FireCellGroup
        cells={stale}
        color={colors.staleOutline}
        opacity={0.5}
        pulsing={false}
        onInspectCell={onInspectCell}
      />
    </>
  );
}

function FireCellGroup({
  cells,
  color,
  opacity,
  pulsing,
  onInspectCell,
}: {
  readonly cells: FireCellMarker[];
  readonly color: string;
  readonly opacity: number;
  readonly pulsing: boolean;
  readonly onInspectCell: (cell: FireCellMarker) => void;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const invalidate = useThree((state) => state.invalidate);

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
    // Canvas uses frameloop="demand" (SceneCanvas.tsx); this mutates the
    // mesh directly, bypassing R3F's reconciler (which would otherwise
    // auto-invalidate on a prop change) - without this, a new snapshot's
    // cell positions would never actually get drawn.
    invalidate();
  }, [cells, dummy, invalidate]);

  // A setInterval (not useFrame) drives the pulse: under frameloop="demand"
  // (SceneCanvas.tsx), useFrame only runs when a render is already
  // happening, and invalidate() from inside it would just request the very
  // next vsync frame - rendering every frame again (measured: ~1000 WebGL
  // draw calls over an idle 3s window). Scheduling the step on its own
  // timer decouples the pulse rate from the frame rate entirely.
  useEffect(() => {
    if (!pulsing || cells.length === 0) return;

    const interval = setInterval(() => {
      const mesh = meshRef.current;
      if (!mesh) return;
      const pulse = 1 + Math.sin((performance.now() / 1000) * 3) * 0.08;
      cells.forEach((cell, index) => {
        dummy.position.set(cell.position.x, CELL_Y, cell.position.z);
        dummy.scale.setScalar(pulse);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      invalidate();
    }, PULSE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pulsing, cells, dummy, invalidate]);

  if (cells.length === 0) return null;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const cell = event.instanceId === undefined ? undefined : cells[event.instanceId];
    if (cell) onInspectCell(cell);
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, cells.length]}
      frustumCulled={false}
      onClick={handleClick}
    >
      <boxGeometry args={[CELL_SIZE, CELL_SIZE * 0.6, CELL_SIZE]} />
      <meshStandardMaterial color={new Color(color)} transparent opacity={opacity} />
    </instancedMesh>
  );
}
