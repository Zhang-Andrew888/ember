import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { RootState } from "@react-three/fiber";
import type { Camera } from "three";
import { SceneCanvas } from "./SceneCanvas.js";
import { SceneLabelLayer, type LabelDescriptor } from "./SceneLabelLayer.js";
import { SceneLegend } from "./SceneLegend.js";
import { SceneCompass } from "./SceneCompass.js";
import type { CameraControlsHandle } from "./CameraControls.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { agentMapLabelMeta, agentMapLabelText, siteMapLabelMeta, siteMapLabelText } from "./mapLabels.js";
import { humanizeReason, labelledBands, polylineMidpoint } from "./sceneLayers.js";
import { listRefugeNodes, type FireCellMarker, type SceneEntities } from "./sceneEntities.js";
import { fireCellTarget, inspectMapTile, type MapInspectionTarget } from "./tileInspection.js";
import { SceneErrorBoundary } from "./SceneErrorBoundary.js";
import { MAP_FAILURE_TEXT, canCreateWebGL, type MapFailure } from "./webglSupport.js";
import { scenarioMap } from "../../map/activeScenario.js";
/**
 * Dev-only scene tuning panel. `import.meta.env.DEV` is a build-time
 * constant, so in a production build this whole expression (including the
 * dynamic import and the panel module) is eliminated.
 */
const DebugPanel = import.meta.env.DEV ? lazy(() => import("./DebugPanel.js")) : null;

/** After this long without a first frame, say so instead of leaving an indefinite loading cover. */
const SLOW_FIRST_FRAME_MS = 12_000;

export interface SceneViewProps {
  readonly entities: SceneEntities;
  readonly selectedAgentId: string | null;
  readonly onInspectAgent: (agentId: string) => void;
  readonly reducedMotion: boolean;
  /** For the fire-cell inspection panel's age readout; null before the first snapshot. */
  readonly simTimeMs: number | null;
  readonly mapAssignMode: boolean;
  readonly mapPreviewFrom: { readonly x: number; readonly z: number } | null;
  readonly mapPreviewTo: { readonly x: number; readonly z: number } | null;
  readonly onMapDestinationPick: (sceneX: number, sceneZ: number) => void;
  readonly mapCommandPanel: ReactNode;
}

interface RenderContext {
  readonly camera: Camera;
  readonly canvasElement: HTMLCanvasElement;
}

/** Combines the 3D canvas, DOM label overlay, and legend into one scene region. */
export function SceneView({
  entities,
  selectedAgentId,
  onInspectAgent,
  reducedMotion,
  simTimeMs,
  mapAssignMode,
  mapPreviewFrom,
  mapPreviewTo,
  onMapDestinationPick,
  mapCommandPanel,
}: SceneViewProps) {
  const [renderContext, setRenderContext] = useState<RenderContext | null>(null);
  const [firstFrameDrawn, setFirstFrameDrawn] = useState(false);
  const [mapFailure, setMapFailure] = useState<MapFailure | null>(() => (canCreateWebGL() ? null : "unsupported"));
  const [slowFirstFrame, setSlowFirstFrame] = useState(false);
  const [canvasAttempt, setCanvasAttempt] = useState(0);
  const [showFireCells, setShowFireCells] = useState(true);
  const [showCurrentFire, setShowCurrentFire] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showForecast, setShowForecast] = useState(true);
  const [follow, setFollow] = useState(true);
  const [inspectionTarget, setInspectionTarget] = useState<MapInspectionTarget | null>(null);
  const handleInspectCell = useCallback((cell: FireCellMarker) => {
    setInspectionTarget(fireCellTarget(cell));
  }, []);
  const handleSelectMapTile = useCallback((gridCellIndex: number) => {
    setInspectionTarget({ kind: "terrain", gridCellIndex });
  }, []);
  const controlsRef = useRef<CameraControlsHandle>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const cellPanelRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const reservedElementRefs = useMemo(() => [legendRef, compassRef, cellPanelRef, dockRef], []);

  const handleReady = useCallback((state: RootState) => {
    const canvasElement = state.gl.domElement;
    canvasElement.addEventListener("webglcontextlost", (event) => {
      // Allows the browser to restore the context; until then the map is reported as stopped.
      event.preventDefault();
      setMapFailure("context-lost");
    });
    canvasElement.addEventListener("webglcontextrestored", () => setMapFailure(null));
    setRenderContext({ camera: state.camera, canvasElement });
  }, []);

  useEffect(() => {
    if (firstFrameDrawn || mapFailure !== null) return;
    const timer = setTimeout(() => setSlowFirstFrame(true), SLOW_FIRST_FRAME_MS);
    return () => clearTimeout(timer);
  }, [firstFrameDrawn, mapFailure, canvasAttempt]);

  const retryMap = () => {
    setRenderContext(null);
    setFirstFrameDrawn(false);
    setSlowFirstFrame(false);
    setMapFailure(canCreateWebGL() ? null : "unsupported");
    setCanvasAttempt((attempt) => attempt + 1);
  };

  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  // Selecting an agent (from the map or the agent rail) starts following it; a pan
  // gesture or the Follow toggle turns that off, so the camera never fights the user.
  useEffect(() => {
    if (selectedAgentId) setFollow(true);
  }, [selectedAgentId]);

  const followTarget = useMemo(() => {
    if (!follow || !selectedAgentId) return null;
    const agent = entities.agents.find((candidate) => candidate.id === selectedAgentId);
    return agent ? { x: agent.position.x, z: agent.position.z } : null;
  }, [follow, selectedAgentId, entities.agents]);
  const handleUserPan = useCallback(() => setFollow(false), []);
  // Clicking an agent on the map also resumes following, even if it was already selected.
  const handleInspectAgent = useCallback(
    (agentId: string) => {
      setFollow(true);
      onInspectAgent(agentId);
    },
    [onInspectAgent],
  );

  const labels = useMemo<LabelDescriptor[]>(() => {
    const refugeLabels = listRefugeNodes(scenarioMap).map((refuge) => ({
      id: `refuge:${refuge.id}`,
      x: refuge.x,
      y: sceneTerrain.groundY(refuge.x, refuge.z) + 30,
      z: refuge.z,
      text: refuge.label ?? "Refuge",
      variant: "refuge" as const,
    }));
    const siteLabels = entities.sites.map((site) => {
      // Status and damage are color-coded on the marker too (a ring sized
      // by damage, separate from the body's protection-status color), but
      // never color-only (docs/FRONTEND.md) - the label always spells both
      // out as text. Sites have no click-to-inspect (unlike agents and fire
      // cells), so the label is the only accessible path to either value.
      const meta = siteMapLabelMeta(site, simTimeMs);
      return {
        id: `site:${site.id}`,
        x: site.position.x,
        y: sceneTerrain.groundY(site.position.x, site.position.z) + 40,
        z: site.position.z,
        text: siteMapLabelText(site),
        variant: "site" as const,
        stale: meta.stale,
        ...(meta.title === undefined ? {} : { title: meta.title }),
      };
    });
    const agentLabels = entities.agents.map((agent) => {
      const meta = agentMapLabelMeta(agent, simTimeMs);
      return {
        id: `agent:${agent.id}`,
        x: agent.position.x,
        y: sceneTerrain.groundY(agent.position.x, agent.position.z) + 44,
        z: agent.position.z,
        text: agentMapLabelText(agent),
        variant: "agent" as const,
        stale: meta.stale,
        ...(meta.title === undefined ? {} : { title: meta.title }),
      };
    });
    const routeLabels = entities.routes.filter((line) => line.labelled !== false).map((line) => {
      const mid = polylineMidpoint(line.points);
      return {
        id: `route:${line.key}`,
        x: mid.x,
        y: sceneTerrain.groundY(mid.x, mid.z) + 10,
        z: mid.z,
        text: line.limitingReason ? `${line.label}: ${humanizeReason(line.limitingReason)}` : line.label,
        variant: "route" as const,
      };
    });
    const forecastLabels = labelledBands(entities.forecast?.bands ?? []).map((band) => {
      const mid = polylineMidpoint(band.points);
      return {
        id: `forecast:${band.key}`,
        x: mid.x,
        y: sceneTerrain.groundY(mid.x, mid.z) + 9,
        z: mid.z,
        text: entities.forecast?.trusted ? band.label : `${band.label} (unreliable)`,
        variant: "forecast" as const,
      };
    });
    return [
      ...refugeLabels,
      ...siteLabels,
      ...agentLabels,
      ...(showRoutes ? routeLabels : []),
      ...(showForecast ? forecastLabels : []),
    ];
  }, [entities, showRoutes, showForecast, simTimeMs]);

  return (
    <div className={`scene-view${mapAssignMode ? " scene-view--map-assign" : ""}`}>
      {mapFailure === null ? (
        <SceneErrorBoundary key={canvasAttempt} onError={() => setMapFailure("crashed")}>
          <SceneCanvas
            ref={controlsRef}
            entities={entities}
            showFireCells={showFireCells}
            showCurrentFire={showCurrentFire}
            showRoutes={showRoutes}
            showForecast={showForecast}
            selectedAgentId={selectedAgentId}
            followTarget={followTarget}
            onUserPan={handleUserPan}
            onInspectAgent={handleInspectAgent}
            onInspectCell={handleInspectCell}
            onSelectMapTile={handleSelectMapTile}
            mapAssignMode={mapAssignMode}
            mapPreviewFrom={mapPreviewFrom}
            mapPreviewTo={mapPreviewTo}
            onMapDestinationPick={onMapDestinationPick}
            onReady={handleReady}
            onFirstFrame={() => setFirstFrameDrawn(true)}
            reducedMotion={reducedMotion}
          />
        </SceneErrorBoundary>
      ) : null}
      {mapFailure !== null ? (
        <MapFailurePanel failure={mapFailure} entities={entities} simTimeMs={simTimeMs} onRetry={retryMap} />
      ) : firstFrameDrawn ? null : (
        <div className="scene-view__loading" role="status">
          <p>Preparing the map…</p>
          {slowFirstFrame ? (
            <p className="scene-view__loading-detail">
              This is taking longer than expected. Crew status and the conversation already work.{" "}
              <button type="button" onClick={retryMap}>
                Try the map again
              </button>
            </p>
          ) : null}
        </div>
      )}
      <SceneLabelLayer
        camera={renderContext?.camera ?? null}
        canvasElement={renderContext?.canvasElement ?? null}
        labels={labels}
        reservedElementRefs={reservedElementRefs}
      />
      {renderContext ? <SceneCompass ref={compassRef} camera={renderContext.camera} /> : null}
      <div className="scene-view__tools">
      <SceneLegend
        ref={legendRef}
        showFireCells={showFireCells}
        onToggleFireCells={() => setShowFireCells((value) => !value)}
        showCurrentFire={showCurrentFire}
        onToggleCurrentFire={() => setShowCurrentFire((value) => !value)}
        currentFire={entities.currentFire}
        showRoutes={showRoutes}
        onToggleRoutes={() => setShowRoutes((value) => !value)}
        showForecast={showForecast}
        onToggleForecast={() => setShowForecast((value) => !value)}
        forecast={entities.forecast}
        showUnseenKey={entities.fireCells.some((cell) => cell.unseen === true)}
        onResetCamera={() => {
          setFollow(false);
          controlsRef.current?.reset();
        }}
        canFollow={selectedAgentId !== null}
        follow={follow}
        onToggleFollow={() => setFollow((value) => !value)}
        fireCells={entities.fireCells}
        onInspectCell={handleInspectCell}
        onInspectMapTile={handleSelectMapTile}
      />
      {mapCommandPanel === null ? null : (
        <div ref={dockRef} className="scene-view__dock">
          {mapCommandPanel}
        </div>
      )}
      </div>
      {DebugPanel ? (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      ) : null}
      {inspectionTarget ? (
        <MapTileInspectionPanel
          panelRef={cellPanelRef}
          target={inspectionTarget}
          entities={entities}
          simTimeMs={simTimeMs}
          onClose={() => setInspectionTarget(null)}
        />
      ) : null}
    </div>
  );
}

/** Coordinator-authorized tile inspection (#125); fire beds and bare terrain share this panel. */
function MapTileInspectionPanel({
  target,
  entities,
  simTimeMs,
  onClose,
  panelRef,
}: {
  readonly target: MapInspectionTarget;
  readonly entities: SceneEntities;
  readonly simTimeMs: number | null;
  readonly onClose: () => void;
  readonly panelRef: RefObject<HTMLDivElement | null>;
}) {
  const inspection = inspectMapTile(target, entities, simTimeMs);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Opened from a keyboard control: move focus into the panel, and back to that control on close.
  useEffect(() => {
    const opener = document.activeElement;
    const fromControl = opener instanceof HTMLElement && opener !== document.body && opener.tagName !== "CANVAS";
    if (fromControl) headingRef.current?.focus();
    return () => {
      if (fromControl && opener.isConnected && (document.activeElement === document.body || document.activeElement === null)) {
        opener.focus();
      }
    };
  }, []);

  return (
    <section ref={panelRef} className="cell-inspection-panel" aria-labelledby={headingId}>
      <button type="button" className="cell-inspection-panel__close" onClick={onClose} aria-label="Close map tile inspection">
        ×
      </button>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="cell-inspection-panel__title">
        Map tile
      </h2>
      <dl>
        <dt>Cell</dt>
        <dd>
          Grid cell {inspection.gridCellIndex} (row {inspection.row}, column {inspection.column})
        </dd>
        <dt>Location</dt>
        <dd>{inspection.location}</dd>
        <dt>Source</dt>
        <dd>{inspection.source}</dd>
        <dt>State</dt>
        <dd>{inspection.state}</dd>
        {inspection.time === null ? null : (
          <>
            <dt>{inspection.timeHeading}</dt>
            <dd>{inspection.time}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** Replaces the canvas when it cannot render; the DOM keeps sites and crews readable. */
function MapFailurePanel({
  failure,
  entities,
  simTimeMs,
  onRetry,
}: {
  readonly failure: MapFailure;
  readonly entities: SceneEntities;
  readonly simTimeMs: number | null;
  readonly onRetry: () => void;
}) {
  return (
    <div className="scene-view__failure" role="alert">
      <p className="scene-view__failure-title">{MAP_FAILURE_TEXT[failure]}</p>
      <p>
        The crew rail, urgent reports and the conversation keep working, so you can still coordinate by text.
        {failure === "unsupported" ? " Turn on hardware acceleration or use another browser to see the map." : null}
      </p>
      {failure === "unsupported" ? null : (
        <button type="button" onClick={onRetry}>
          Try the map again
        </button>
      )}
      {entities.sites.length > 0 ? (
        <>
          <h2 className="scene-view__failure-heading">Sites as last reported</h2>
          <ul>
            {entities.sites.map((site) => (
              <li key={site.id}>
                {siteMapLabelText(site)}
                {siteMapLabelMeta(site, simTimeMs).stale ? " (stale)" : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
