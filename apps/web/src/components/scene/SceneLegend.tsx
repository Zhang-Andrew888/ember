import { colors } from "../../styles/colors.js";

export interface SceneLegendProps {
  readonly showFireCells: boolean;
  readonly onToggleFireCells: () => void;
  readonly onResetCamera: () => void;
}

/**
 * Upper scene-corner overlay: layer legend and reset camera
 * (docs/FRONTEND.md). These are inspection/view controls only - never
 * command controls (nothing here issues a task or addresses a crew).
 */
export function SceneLegend({ showFireCells, onToggleFireCells, onResetCamera }: SceneLegendProps) {
  return (
    <div className="scene-legend" role="group" aria-label="Map layers and camera">
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
    </div>
  );
}
