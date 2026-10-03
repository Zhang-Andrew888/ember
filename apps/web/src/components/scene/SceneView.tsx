import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { RootState } from "@react-three/fiber";
import type { Camera } from "three";
import { SceneCanvas } from "./SceneCanvas.js";
import { SceneLabelLayer, type LabelDescriptor } from "./SceneLabelLayer.js";
import { SceneLegend } from "./SceneLegend.js";
import type { CameraControlsHandle } from "./CameraControls.js";
import { listRefugeNodes, type FireCellMarker, type SceneEntities } from "./sceneEntities.js";
import { scenarioMap } from "../../map/scenarioMap.js";
import { siteProtectionStatusLabel } from "../../format/reports.js";
import { formatIncidentClock } from "../../format/time.js";

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

  // Selecting an agent (from the map or the agent rail) re-centers the
  // camera once; it must not fight the user's own pan on every snapshot,
  // so this only reacts to a changed selection, not to every tick's entities.
  useEffect(() => {
    if (!selectedAgentId) return;
    const agent = entitiesRef.current.agents.find((candidate) => candidate.id === selectedAgentId);
    if (!agent) return;
    controlsRef.current?.focusOn(agent.position.x, agent.position.z);
  }, [selectedAgentId]);

  const labels = useMemo<LabelDescriptor[]>(() => {
    const refugeLabels = listRefugeNodes(scenarioMap).map((refuge) => ({
      id: `refuge:${refuge.id}`,
      x: refuge.x,
      y: 14,
      z: refuge.z,
      text: refuge.label ?? "Refuge",
      variant: "refuge" as const,
    }));
    const siteLabels = entities.sites.map((site) => ({
      id: `site:${site.id}`,
      x: site.position.x,
      y: 18,
      z: site.position.z,
      // Status is color-coded on the marker too, but never color-only
      // (docs/FRONTEND.md) - the label always spells it out as text.
      text: `${site.name} — ${siteProtectionStatusLabel(site.protectionStatus)}${site.stale ? " (stale)" : ""}`,
      variant: "site" as const,
    }));
    const agentLabels = entities.agents.map((agent) => ({
      id: `agent:${agent.id}`,
      x: agent.position.x,
      y: 22,
      z: agent.position.z,
      text: agent.callsign,
      variant: "agent" as const,
    }));
    return [...refugeLabels, ...siteLabels, ...agentLabels];
  }, [entities]);

  return (
    <div className="scene-view">
      <SceneCanvas
        ref={controlsRef}
        entities={entities}
        showFireCells={showFireCells}
        selectedAgentId={selectedAgentId}
        onInspectAgent={onInspectAgent}
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
        onResetCamera={() => controlsRef.current?.reset()}
      />
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
          {cell.edgeId} (cell {cell.cellIndex})
        </dd>
        <dt>State</dt>
        <dd>{cell.burnState}</dd>
        <dt>Last observed</dt>
        <dd>
          {formatIncidentClock(cell.lastObservedAt)}
          {ageMs !== null ? ` (${Math.round(ageMs / 1000)}s ago)` : ""}
          {cell.stale ? " — stale" : ""}
        </dd>
      </dl>
    </div>
  );
}
