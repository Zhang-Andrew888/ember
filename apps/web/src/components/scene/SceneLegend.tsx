import { forwardRef } from "react";
import { colors } from "../../styles/colors.js";
import { formatIncidentClock } from "../../format/time.js";
import type { FireCellMarker } from "./sceneEntities.js";

export interface SceneLegendProps {
  readonly showFireCells: boolean;
  readonly onToggleFireCells: () => void;
  readonly onResetCamera: () => void;
  readonly fireCells: FireCellMarker[];
  readonly onInspectCell: (cell: FireCellMarker) => void;
}

/**
 * Upper scene-corner overlay: layer legend and reset camera
 * (docs/FRONTEND.md). These are inspection/view controls only - never
 * command controls (nothing here issues a task or addresses a crew).
 * Forwards a ref to its root element so SceneView can measure it and keep
 * scene labels from rendering underneath it.
 */
export const SceneLegend = forwardRef<HTMLDivElement, SceneLegendProps>(function SceneLegend(
  { showFireCells, onToggleFireCells, onResetCamera, fireCells, onInspectCell },
  ref,
) {
  return (
    <div ref={ref} className="scene-legend" role="group" aria-label="Map layers and camera">
      <ul className="scene-legend__key">
        <li>
          <span className="scene-legend__swatch" style={{ background: colors.observedFire }} />
          Observed fire
        </li>
        <li>
          <span className="scene-legend__swatch" style={{ background: colors.staleOutline }} />
          Stale observation
        </li>
        <li>
          <span className="scene-legend__swatch" style={{ background: colors.refuge }} />
          Refuge
        </li>
      </ul>
      <div className="scene-legend__controls">
        <label className="scene-legend__toggle">
          <input type="checkbox" checked={showFireCells} onChange={onToggleFireCells} />
          Show fire observations
        </label>
        <button type="button" onClick={onResetCamera}>
          Reset camera
        </button>
      </div>
      {/*
        Clicking a fire cell in the 3D scene inspects it (FireCells.tsx),
        but a <canvas> has no accessible children at all - there is no
        keyboard or screen-reader path to that otherwise. This <details>
        is the DOM equivalent: same inspection, reachable by keyboard.
      */}
      {fireCells.length > 0 ? (
        <details className="scene-legend__cells">
          <summary>Observed cells ({fireCells.length})</summary>
          <ul>
            {fireCells.map((cell) => (
              <li key={cell.key}>
                <button type="button" onClick={() => onInspectCell(cell)}>
                  {cell.edgeId} (cell {cell.cellIndex}) — {cell.burnState}
                  {cell.stale ? ", stale" : ""}, last observed {formatIncidentClock(cell.lastObservedAt)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
});
