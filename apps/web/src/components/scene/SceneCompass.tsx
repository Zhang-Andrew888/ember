import { forwardRef, useEffect, useRef } from "react";
import type { Camera } from "three";
import { northBearing } from "./compassMath.js";

const CARDINALS = ["N", "E", "S", "W"] as const;

function cardinalPosition(bearing: number, index: number): { left: string; top: string } {
  const angle = bearing - index * Math.PI / 2;
  return {
    left: `${50 + 36 * Math.sin(angle)}%`,
    top: `${50 - 36 * Math.cos(angle)}%`,
  };
}

/** Read-only compass that follows camera orbit and animated reset. */
export const SceneCompass = forwardRef<HTMLDivElement, { readonly camera: Camera }>(function SceneCompass(
  { camera },
  forwardedRef,
) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const labels = rootRef.current?.querySelectorAll<HTMLElement>(".scene-compass__direction");
    if (!labels) return;
    let frameId: number;
    let previousBearing: number | null = null;
    const update = () => {
      const bearing = northBearing(camera);
      if (bearing !== previousBearing) {
        labels.forEach((label, index) => {
          const position = cardinalPosition(bearing, index);
          label.style.left = position.left;
          label.style.top = position.top;
        });
        previousBearing = bearing;
      }
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [camera]);

  return (
    <div
      ref={(element) => {
        rootRef.current = element;
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }}
      className="scene-compass"
      role="img"
      aria-label="Map compass: north, east, south, west"
    >
      <span className="scene-compass__center" aria-hidden="true" />
      {CARDINALS.map((direction, index) => (
        <span
          key={direction}
          className={`scene-compass__direction scene-compass__direction--${direction.toLowerCase()}`}
          style={cardinalPosition(northBearing(camera), index)}
          aria-hidden="true"
        >
          {direction}
        </span>
      ))}
    </div>
  );
});
