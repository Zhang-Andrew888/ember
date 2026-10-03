import { useEffect, useRef } from "react";
import type { Camera } from "three";
import { Vector3 } from "three";
import type { RefObject } from "react";
import { projectToScreen } from "./projectToScreen.js";
import { resolveLabelCollisions, type ReservedBox, type SizedLabelPoint } from "./stackLabels.js";

const LABEL_HEIGHT_PX = 20;
/** Rough glyph width estimate so two co-located labels don't overlap; not pixel-exact. */
const CHAR_WIDTH_PX = 6.5;
const LABEL_PADDING_PX = 16;

export interface LabelDescriptor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly text: string;
  readonly variant: "agent" | "site" | "refuge" | "route" | "forecast";
  /** Old information: dashed, dimmed label (text carries the age too). */
  readonly stale?: boolean;
}

export interface SceneLabelLayerProps {
  readonly camera: Camera | null;
  readonly canvasElement: HTMLCanvasElement | null;
  readonly labels: LabelDescriptor[];
  /** Fixed UI overlays (legend, inspection panel) that scene labels must not render underneath. */
  readonly reservedElementRefs?: ReadonlyArray<RefObject<HTMLElement | null>>;
}

/**
 * Real DOM labels positioned over the Three.js canvas (docs/FRONTEND.md
 * scene layer 7), driven by its own requestAnimationFrame loop rather than
 * React state so repositioning never triggers a reconciliation pass
 * (docs/FRONTEND.md: "keep simulation state out of per-frame React
 * reconciliation").
 */
export function SceneLabelLayer({
  camera,
  canvasElement,
  labels,
  reservedElementRefs = [],
}: SceneLabelLayerProps) {
  const elementsRef = useRef(new Map<string, HTMLDivElement>());
  const worldPoint = useRef(new Vector3());

  useEffect(() => {
    let frameId: number;

    const tick = () => {
      if (camera && canvasElement) {
        const rect = canvasElement.getBoundingClientRect();
        const sized: SizedLabelPoint[] = labels.map((label) => {
          worldPoint.current.set(label.x, label.y, label.z);
          const screen = projectToScreen(camera, worldPoint.current, rect.width, rect.height);
          return {
            id: label.id,
            x: screen.x,
            y: screen.y,
            visible: screen.visible,
            width: label.text.length * CHAR_WIDTH_PX + LABEL_PADDING_PX,
            height: LABEL_HEIGHT_PX,
          };
        });
        const reservedBoxes: ReservedBox[] = reservedElementRefs
          .map((ref) => ref.current?.getBoundingClientRect())
          .filter((box): box is DOMRect => box !== undefined)
          .map((box) => ({
            left: box.left - rect.left,
            right: box.right - rect.left,
            top: box.top - rect.top,
            bottom: box.bottom - rect.top,
          }));
        const placed = resolveLabelCollisions(sized, undefined, reservedBoxes);

        for (const point of placed) {
          const element = elementsRef.current.get(point.id);
          if (!element) continue;
          element.style.display = point.visible ? "block" : "none";
          element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -140%)`;
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
          className={`scene-label scene-label--${label.variant}${label.stale ? " scene-label--stale" : ""}`}
        >
          {label.text}
        </div>
      ))}
    </div>
  );
}
