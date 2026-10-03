import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { RootState } from "@react-three/fiber";
import type { Camera } from "three";
import { SceneCanvas } from "./SceneCanvas.js";
import { SceneLabelLayer, type LabelDescriptor } from "./SceneLabelLayer.js";
import { SceneLegend } from "./SceneLegend.js";
import type { CameraControlsHandle } from "./CameraControls.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { agentLabelText } from "./models/markerCues.js";
import { freshness } from "./staleness.js";
import { polylineMidpoint } from "./sceneLayers.js";
import { listRefugeNodes, type FireCellMarker, type SceneEntities } from "./sceneEntities.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { siteProtectionStatusLabel, siteDamageLabel } from "../../format/reports.js";
import { formatIncidentClock } from "../../format/time.js";

/**
 * Dev-only scene tuning panel. `import.meta.env.DEV` is a build-time
 * constant, so in a production build this whole expression (including the
 * dynamic import and the panel module) is eliminated.
 */
const DebugPanel = import.meta.env.DEV ? lazy(() => import("./DebugPanel.js")) : null;

export interface SceneViewProps {
  readonly entities: SceneEntities;
  readonly selectedAgentId: string | null;
  readonly onInspectAgent: (agentId: string) => void;
  readonly reducedMotion: boolean;
  /** For the fire-cell inspection panel's age readout; null before the first snapshot. */
  readonly simTimeMs: number | null;
}

interface RenderContext {
  readonly camera: Camera;
  readonly canvasElement: HTMLCanvasElement;
}

function agentStaleText(agent: SceneEntities["agents"][number]): string {
  const base = agentLabelText(agent.callsign, agent.state);
  const fresh = freshness(agent.ageMs);
  return fresh.stale ? `${base} (${fresh.ageLabel})` : base;
}

/** Combines the 3D canvas, DOM label overlay, and legend into one scene region. */
export function SceneView({
  entities,
  selectedAgentId,
  onInspectAgent,
  reducedMotion,
  simTimeMs,
}: SceneViewProps) {
  const [renderContext, setRenderContext] = useState<RenderContext | null>(null);
  const [showFireCells, setShowFireCells] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showForecast, setShowForecast] = useState(true);
  const [follow, setFollow] = useState(true);
  const [inspectedCell, setInspectedCell] = useState<FireCellMarker | null>(null);
  const controlsRef = useRef<CameraControlsHandle>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const cellPanelRef = useRef<HTMLDivElement>(null);
  const reservedElementRefs = useMemo(() => [legendRef, cellPanelRef], []);

  const handleReady = useCallback((state: RootState) => {
    setRenderContext({ camera: state.camera, canvasElement: state.gl.domElement });
  }, []);

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
      const damageLabel = siteDamageLabel(site.damage);
      const fresh = freshness(site.ageMs, site.stale);
      return {
        id: `site:${site.id}`,
        x: site.position.x,
        y: sceneTerrain.groundY(site.position.x, site.position.z) + 40,
        z: site.position.z,
        text: `${site.name} — ${siteProtectionStatusLabel(site.protectionStatus)}${damageLabel ? `, ${damageLabel}` : ""}${fresh.stale && site.ageMs !== null ? ` (stale, ${fresh.ageLabel})` : ""}`,
        variant: "site" as const,
        stale: fresh.stale && site.ageMs !== null,
      };
    });
    const agentLabels = entities.agents.map((agent) => ({
      id: `agent:${agent.id}`,
      x: agent.position.x,
      y: sceneTerrain.groundY(agent.position.x, agent.position.z) + 44,
      z: agent.position.z,
      text: agentStaleText(agent),
      variant: "agent" as const,
      stale: freshness(agent.ageMs).stale,
    }));
    const routeLabels = entities.routes.map((line) => {
      const mid = polylineMidpoint(line.points);
      return {
        id: `route:${line.key}`,
        x: mid.x,
        y: sceneTerrain.groundY(mid.x, mid.z) + 10,
        z: mid.z,
        text: line.limitingReason ? `${line.label} — ${line.limitingReason}` : line.label,
        variant: "route" as const,
      };
    });
    const forecastLabels = (entities.forecast?.bands ?? []).map((band) => {
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
  }, [entities, showRoutes, showForecast]);

  return (
    <div className="scene-view">
      <SceneCanvas
        ref={controlsRef}
        entities={entities}
        showFireCells={showFireCells}
        showRoutes={showRoutes}
        showForecast={showForecast}
        selectedAgentId={selectedAgentId}
        followTarget={followTarget}
        onUserPan={handleUserPan}
        onInspectAgent={handleInspectAgent}
        onInspectCell={setInspectedCell}
        onReady={handleReady}
        reducedMotion={reducedMotion}
      />
      <SceneLabelLayer
        camera={renderContext?.camera ?? null}
        canvasElement={renderContext?.canvasElement ?? null}
        labels={labels}
        reservedElementRefs={reservedElementRefs}
      />
      <SceneLegend
        ref={legendRef}
        showFireCells={showFireCells}
        onToggleFireCells={() => setShowFireCells((value) => !value)}
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
        onInspectCell={setInspectedCell}
      />
      {DebugPanel ? (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      ) : null}
      {inspectedCell ? (
        <CellInspectionPanel
          panelRef={cellPanelRef}
          cell={inspectedCell}
          simTimeMs={simTimeMs}
          onClose={() => setInspectedCell(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * "Observed burned/active cells, with timestamps in inspection"
 * (docs/FRONTEND.md scene layer 3) - clicking a fire cell shows when it was
 * last observed, not just its current color.
 */
function CellInspectionPanel({
  cell,
  simTimeMs,
  onClose,
  panelRef,
}: {
  readonly cell: FireCellMarker;
  readonly simTimeMs: number | null;
  readonly onClose: () => void;
  readonly panelRef: RefObject<HTMLDivElement | null>;
}) {
  const ageMs = simTimeMs === null ? null : Math.max(0, simTimeMs - cell.lastObservedAt);
  return (
    <div ref={panelRef} className="cell-inspection-panel" role="status">
      <button type="button" className="cell-inspection-panel__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <dl>
        <dt>Edge</dt>
        <dd>
          Grid cell {cell.gridCellIndex}
        </dd>
        <dt>State</dt>
        <dd>{cell.burnState}</dd>
        {cell.unseen ? (
          <>
            <dt>Observation</dt>
            <dd>This state was not observed by the coordinator (full simulated fire, replay only)</dd>
          </>
        ) : null}
        {cell.unseen ? null : (
          <>
            <dt>Last observed</dt>
            <dd>
              {formatIncidentClock(cell.lastObservedAt)}
              {ageMs !== null ? ` (${Math.round(ageMs / 1000)}s ago)` : ""}
              {cell.stale ? " — stale" : ""}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
