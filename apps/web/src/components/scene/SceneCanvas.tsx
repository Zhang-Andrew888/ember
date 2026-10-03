import { forwardRef, useMemo } from "react";
import { Canvas, type RootState } from "@react-three/fiber";
import { Terrain } from "./Terrain.js";
import { Trees } from "./Trees.js";
import { QualityProvider } from "./quality/QualityContext.js";
import { effectiveQuality } from "./quality/tiers.js";
import { Roads } from "./Roads.js";
import { FireCells } from "./FireCells.js";
import { SiteMarkers, RefugeMarkers } from "./SiteMarkers.js";
import { RouteLayer } from "./RouteLayer.js";
import { ForecastLayer } from "./ForecastLayer.js";
import { AgentMarkers } from "./AgentMarkers.js";
import { CameraControls, type CameraControlsHandle } from "./CameraControls.js";
import { listRefugeNodes } from "./sceneEntities.js";
import { scenarioMap } from "../../map/activeScenario.js";
import type { FireCellMarker, SceneEntities } from "./sceneEntities.js";

const ATMOSPHERE = {
  background: "#111a22",
  fog: "#18242e",
  fogNear: 650,
  fogFar: 1900,
  skyFill: "#8aa6d0",
  groundFill: "#2b2a22",
  key: "#ffbf80",
} as const;
const INITIAL_ZOOM = 0.72;
// ~50 degree tilt from the ground plane (docs/FRONTEND.md "fixed initial tilt around 50 degrees").
const INITIAL_CAMERA_POSITION: [number, number, number] = [0, 520, 440];

export interface SceneCanvasProps {
  readonly entities: SceneEntities;
  readonly showFireCells: boolean;
  readonly showRoutes: boolean;
  readonly showForecast: boolean;
  readonly selectedAgentId: string | null;
  readonly onInspectAgent: (agentId: string) => void;
  readonly onInspectCell: (cell: FireCellMarker) => void;
  readonly onReady: (state: RootState) => void;
  readonly reducedMotion: boolean;
}

export const SceneCanvas = forwardRef<CameraControlsHandle, SceneCanvasProps>(function SceneCanvas(
  { entities, showFireCells, showRoutes, showForecast, selectedAgentId, onInspectAgent, onInspectCell, onReady, reducedMotion },
  controlsRef,
) {
  const quality = useMemo(() => effectiveQuality("high", reducedMotion), [reducedMotion]);
  const refuges = listRefugeNodes(scenarioMap);
  const routeLines = useMemo(
    () => entities.routes.map((line) => ({ ...line, selected: line.agentId === selectedAgentId })),
    [entities.routes, selectedAgentId],
  );

  return (
    <Canvas
      orthographic
      camera={{ position: INITIAL_CAMERA_POSITION, zoom: INITIAL_ZOOM, near: 1, far: 4000 }}
      dpr={[1, quality.dprMax]}
      onCreated={onReady}
      // The scene is static between interactions - render on demand
      // (camera move, new snapshot, pulse animation) instead of a
      // continuous 60fps loop. See CameraControls.tsx and FireCells.tsx
      // for the invalidate() calls that keep this correct.
      frameloop="demand"
    >
      {/* Dusk: cool sky fill, one low warm key from the west, haze toward the far edge. */}
      <color attach="background" args={[ATMOSPHERE.background]} />
      <fog attach="fog" args={[ATMOSPHERE.fog, ATMOSPHERE.fogNear, ATMOSPHERE.fogFar]} />
      <hemisphereLight args={[ATMOSPHERE.skyFill, ATMOSPHERE.groundFill, 0.85]} />
      <directionalLight position={[-420, 300, 260]} color={ATMOSPHERE.key} intensity={1.0} />
      <QualityProvider value={quality}>
      <Terrain />
      <Trees fireCells={entities.fireCells} reducedMotion={reducedMotion} />
      <Roads />
      {showForecast && entities.forecast ? <ForecastLayer layer={entities.forecast} /> : null}
      <RefugeMarkers refuges={refuges} />
      <SiteMarkers sites={entities.sites} />
      {showFireCells ? (
        <FireCells cells={entities.fireCells} reducedMotion={reducedMotion} onInspectCell={onInspectCell} />
      ) : null}
      {showRoutes ? <RouteLayer lines={routeLines} /> : null}
      <AgentMarkers
        agents={entities.agents}
        selectedAgentId={selectedAgentId}
        onInspectAgent={onInspectAgent}
      />
      <CameraControls ref={controlsRef} reducedMotion={reducedMotion} />
      </QualityProvider>
    </Canvas>
  );
});
