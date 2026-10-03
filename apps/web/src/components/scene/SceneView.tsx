import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RootState } from "@react-three/fiber";
import type { Camera } from "three";
import { SceneCanvas } from "./SceneCanvas.js";
import { SceneLabelLayer, type LabelDescriptor } from "./SceneLabelLayer.js";
import { SceneLegend } from "./SceneLegend.js";
import type { CameraControlsHandle } from "./CameraControls.js";
import { listRefugeNodes, type SceneEntities } from "./sceneEntities.js";
import { scenarioMap } from "../../map/scenarioMap.js";

export interface SceneViewProps {
  readonly entities: SceneEntities;
  readonly selectedAgentId: string | null;
  readonly onInspectAgent: (agentId: string) => void;
  readonly reducedMotion: boolean;
}

interface RenderContext {
  readonly camera: Camera;
  readonly canvasElement: HTMLCanvasElement;
}

/** Combines the 3D canvas, DOM label overlay, and legend into one scene region. */
export function SceneView({ entities, selectedAgentId, onInspectAgent, reducedMotion }: SceneViewProps) {
  const [renderContext, setRenderContext] = useState<RenderContext | null>(null);
  const [showFireCells, setShowFireCells] = useState(true);
  const controlsRef = useRef<CameraControlsHandle>(null);

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
      text: site.name,
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
        onReady={handleReady}
        reducedMotion={reducedMotion}
      />
      <SceneLabelLayer
        camera={renderContext?.camera ?? null}
        canvasElement={renderContext?.canvasElement ?? null}
        labels={labels}
      />
      <SceneLegend
        showFireCells={showFireCells}
        onToggleFireCells={() => setShowFireCells((value) => !value)}
        onResetCamera={() => controlsRef.current?.reset()}
      />
    </div>
  );
}
