import { forwardRef, useMemo, useRef } from "react";
import { Canvas, useFrame, type RootState } from "@react-three/fiber";
import { Terrain } from "./Terrain.js";
import { Trees } from "./Trees.js";
import { Fire } from "./Fire.js";
import { SceneClock } from "./anim/sceneClock.js";
import { QualityProvider } from "./quality/QualityContext.js";
import { effectiveQuality } from "./quality/tiers.js";
import { currentTier, useQualityState } from "./quality/qualityStore.js";
import { RenderPipeline } from "./RenderPipeline.js";
import { Roads } from "./Roads.js";
import { FireCells } from "./FireCells.js";
import { SiteMarkers, RefugeMarkers } from "./SiteMarkers.js";
import { RouteLayer } from "./RouteLayer.js";
import { ForecastLayer } from "./ForecastLayer.js";
import { AgentMarkers } from "./AgentMarkers.js";
import { MapDestinationPicker } from "./MapDestinationPicker.js";
import { CameraControls, type CameraControlsHandle } from "./CameraControls.js";
import { listRefugeNodes, litFireCells } from "./sceneEntities.js";
import { scenarioMap } from "../../map/activeScenario.js";
import type { FireCellMarker, SceneEntities } from "./sceneEntities.js";

const INITIAL_ZOOM = 0.72;
// ~50 degree tilt from the ground plane (docs/FRONTEND.md "fixed initial tilt around 50 degrees").
const INITIAL_CAMERA_POSITION: [number, number, number] = [0, 520, 440];

export interface SceneCanvasProps {
  readonly entities: SceneEntities;
  readonly showFireCells: boolean;
  readonly showCurrentFire: boolean;
  readonly showRoutes: boolean;
  readonly showForecast: boolean;
  readonly selectedAgentId: string | null;
  readonly followTarget: { readonly x: number; readonly z: number } | null;
  readonly onUserPan: () => void;
  readonly onInspectAgent: (agentId: string) => void;
  readonly onInspectCell: (cell: FireCellMarker) => void;
  readonly onSelectMapTile: (gridCellIndex: number) => void;
  readonly mapAssignMode: boolean;
  readonly mapPreviewFrom: { readonly x: number; readonly z: number } | null;
  readonly mapPreviewTo: { readonly x: number; readonly z: number } | null;
  readonly onMapDestinationPick: (sceneX: number, sceneZ: number) => void;
  readonly onReady: (state: RootState) => void;
  /** Called once, after the first frame has been drawn (shaders compiled, geometry uploaded). */
  readonly onFirstFrame?: () => void;
  readonly reducedMotion: boolean;
}

/** Fires `onFirstFrame` once the first frame has been rendered, so the page can drop its loading cover. */
function FirstFrame({ onFirstFrame }: { readonly onFirstFrame: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    // useFrame runs before the draw; wait one animation frame so the picture is actually on screen.
    requestAnimationFrame(() => requestAnimationFrame(onFirstFrame));
  });
  return null;
}

export const SceneCanvas = forwardRef<CameraControlsHandle, SceneCanvasProps>(function SceneCanvas(
  {
    entities,
    showFireCells,
    showCurrentFire,
    showRoutes,
    showForecast,
    selectedAgentId,
    followTarget,
    onUserPan,
    onInspectAgent,
    onInspectCell,
    onSelectMapTile,
    mapAssignMode,
    mapPreviewFrom,
    mapPreviewTo,
    onMapDestinationPick,
    onReady,
    onFirstFrame,
    reducedMotion,
  },
  controlsRef,
) {
  const qualityState = useQualityState();
  const tier = currentTier(qualityState);
  const params = qualityState.params;
  const quality = useMemo(() => effectiveQuality(tier, reducedMotion), [tier, reducedMotion]);
  // The fire toggles govern every fire effect (flames, ground light, char), not just the tiles. The
  // actual fire is the current-fire layer when the feed has one; observations are then only outlined.
  const visibleCells = useMemo(
    () => litFireCells(entities, { currentFire: showCurrentFire, observed: showFireCells }),
    [entities, showCurrentFire, showFireCells],
  );
  const currentCells = useMemo(
    () => (showCurrentFire && entities.currentFire ? entities.currentFire.cells : []),
    [showCurrentFire, entities.currentFire],
  );
  const refuges = listRefugeNodes(scenarioMap);
  const routeLines = useMemo(
    () => entities.routes.map((line) => ({ ...line, selected: line.agentId === selectedAgentId })),
    [entities.routes, selectedAgentId],
  );

  return (
    <Canvas
      orthographic
      shadows="soft"
      camera={{ position: INITIAL_CAMERA_POSITION, zoom: INITIAL_ZOOM, near: 1, far: 4000 }}
      dpr={[...quality.dpr]}
      onCreated={onReady}
      // The scene is static between interactions - render on demand
      // (camera move, new snapshot, pulse animation) instead of a
      // continuous 60fps loop. See CameraControls.tsx and anim/sceneClock.tsx
      // for the invalidate() calls that keep this correct.
      frameloop="demand"
    >
      {/* Dusk: cool sky fill, one low warm key from the west, haze toward the far edge. */}
      <color attach="background" args={[params.background]} />
      <fog attach="fog" args={[params.fog, params.fogNear, params.fogFar]} />
      <hemisphereLight args={[params.skyFill, params.groundFill, params.fillIntensity]} />
      <directionalLight
        position={[...params.keyPosition]}
        color={params.key}
        intensity={params.keyIntensity}
        castShadow={quality.shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-800}
        shadow-camera-right={800}
        shadow-camera-top={800}
        shadow-camera-bottom={-800}
        shadow-camera-near={10}
        shadow-camera-far={1800}
        shadow-bias={-0.0006}
      />
      {onFirstFrame ? <FirstFrame onFirstFrame={onFirstFrame} /> : null}
      <RenderPipeline config={quality} params={params} autoEnabled={qualityState.mode === "auto"} />
      <QualityProvider value={quality}>
      <Terrain tilePickEnabled={!mapAssignMode} onSelectTile={onSelectMapTile} />
      <SceneClock animated={!reducedMotion} />
      <Trees fireCells={visibleCells} reducedMotion={reducedMotion} />
      <Fire cells={visibleCells} reducedMotion={reducedMotion} />
      <Roads />
      {showForecast && entities.forecast ? <ForecastLayer layer={entities.forecast} /> : null}
      <RefugeMarkers refuges={refuges} />
      <SiteMarkers sites={entities.sites} />
      {showFireCells || showCurrentFire ? (
        <FireCells
          current={currentCells}
          currentFirePresent={entities.currentFire !== null}
          cells={showFireCells ? entities.fireCells : []}
          onInspectCell={onInspectCell}
        />
      ) : null}
      {showRoutes ? <RouteLayer lines={routeLines} /> : null}
      <AgentMarkers
        agents={entities.agents}
        selectedAgentId={selectedAgentId}
        onInspectAgent={onInspectAgent}
      />
      <MapDestinationPicker
        active={mapAssignMode}
        from={mapPreviewFrom}
        to={mapPreviewTo}
        onPickScene={onMapDestinationPick}
      />
      <CameraControls ref={controlsRef} reducedMotion={reducedMotion} followTarget={followTarget} onUserPan={onUserPan} />
      </QualityProvider>
    </Canvas>
  );
});
