import { forwardRef } from "react";
import { Canvas, type RootState } from "@react-three/fiber";
import { Terrain } from "./Terrain.js";
import { Roads } from "./Roads.js";
import { FireCells } from "./FireCells.js";
import { SiteMarkers, RefugeMarkers } from "./SiteMarkers.js";
import { AgentMarkers } from "./AgentMarkers.js";
import { CameraControls, type CameraControlsHandle } from "./CameraControls.js";
import { listRefugeNodes } from "./sceneEntities.js";
import { scenarioMap } from "../../map/scenarioMap.js";
import type { FireCellMarker, SceneEntities } from "./sceneEntities.js";

const INITIAL_ZOOM = 1.1;
// ~50 degree tilt from the ground plane (docs/FRONTEND.md "fixed initial tilt around 50 degrees").
const INITIAL_CAMERA_POSITION: [number, number, number] = [0, 520, 440];

export interface SceneCanvasProps {
  readonly entities: SceneEntities;
  readonly showFireCells: boolean;
  readonly selectedAgentId: string | null;
  readonly onInspectAgent: (agentId: string) => void;
  readonly onInspectCell: (cell: FireCellMarker) => void;
  readonly onReady: (state: RootState) => void;
  readonly reducedMotion: boolean;
}

export const SceneCanvas = forwardRef<CameraControlsHandle, SceneCanvasProps>(function SceneCanvas(
  { entities, showFireCells, selectedAgentId, onInspectAgent, onInspectCell, onReady, reducedMotion },
  controlsRef,
) {
  const refuges = listRefugeNodes(scenarioMap);

  return (
    <Canvas
      orthographic
      camera={{ position: INITIAL_CAMERA_POSITION, zoom: INITIAL_ZOOM, near: 1, far: 4000 }}
      dpr={[1, 1.5]}
      onCreated={onReady}
      // The scene is static between interactions - render on demand
      // (camera move, new snapshot, pulse animation) instead of a
      // continuous 60fps loop. See CameraControls.tsx and FireCells.tsx
      // for the invalidate() calls that keep this correct.
      frameloop="demand"
    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[300, 500, 200]} intensity={0.9} />
      <Terrain />
      <Roads />
      <RefugeMarkers refuges={refuges} />
      <SiteMarkers sites={entities.sites} />
      {showFireCells ? (
        <FireCells cells={entities.fireCells} reducedMotion={reducedMotion} onInspectCell={onInspectCell} />
      ) : null}
      <AgentMarkers
        agents={entities.agents}
        selectedAgentId={selectedAgentId}
        onInspectAgent={onInspectAgent}
      />
      <CameraControls ref={controlsRef} reducedMotion={reducedMotion} />
    </Canvas>
  );
});
