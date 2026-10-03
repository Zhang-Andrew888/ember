import { useEffect, useRef } from "react";
import type { Camera } from "three";
import { Vector3 } from "three";
import { projectToScreen } from "./projectToScreen.js";

export interface LabelDescriptor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly text: string;
  readonly variant: "agent" | "site" | "refuge";
}

export interface SceneLabelLayerProps {
  readonly camera: Camera | null;
  readonly canvasElement: HTMLCanvasElement | null;
  readonly labels: LabelDescriptor[];
}

/**
 * Real DOM labels positioned over the Three.js canvas (docs/FRONTEND.md
 * scene layer 7), driven by its own requestAnimationFrame loop rather than
 * React state so repositioning never triggers a reconciliation pass
 * (docs/FRONTEND.md: "keep simulation state out of per-frame React
 * reconciliation").
 */
export function SceneLabelLayer({ camera, canvasElement, labels }: SceneLabelLayerProps) {
  const elementsRef = useRef(new Map<string, HTMLDivElement>());
  const worldPoint = useRef(new Vector3());

  useEffect(() => {
    let frameId: number;

    const tick = () => {
      if (camera && canvasElement) {
        const rect = canvasElement.getBoundingClientRect();
        for (const label of labels) {
          const element = elementsRef.current.get(label.id);
          if (!element) continue;
          worldPoint.current.set(label.x, label.y, label.z);
          const screen = projectToScreen(camera, worldPoint.current, rect.width, rect.height);
          element.style.display = screen.visible ? "block" : "none";
          element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -140%)`;
        }
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [camera, canvasElement, labels]);

  return (
    <div className="scene-label-layer">
      {labels.map((label) => (
        <div
          key={label.id}
          ref={(element) => {
            if (element) elementsRef.current.set(label.id, element);
            else elementsRef.current.delete(label.id);
          }}
          className={`scene-label scene-label--${label.variant}`}
        >
          {label.text}
        </div>
      ))}
    </div>
  );
}
