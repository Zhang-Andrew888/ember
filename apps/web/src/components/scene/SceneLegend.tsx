import { forwardRef, useState } from "react";
import { colors } from "../../styles/colors.js";
import type { ForecastLayer } from "./sceneLayers.js";
import { scenarioMap } from "../../map/activeScenario.js";
import type { FireCellMarker } from "./sceneEntities.js";

export interface SceneLegendProps {
  readonly showFireCells: boolean;
  readonly onToggleFireCells: () => void;
  readonly showRoutes: boolean;
  readonly onToggleRoutes: () => void;
  readonly showForecast: boolean;
  readonly onToggleForecast: () => void;
  readonly forecast: ForecastLayer | null;
  /** Replay with the full fire on: explain the dashed frames. */
  readonly showUnseenKey?: boolean;
  readonly canFollow: boolean;
  readonly follow: boolean;
  readonly onToggleFollow: () => void;
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
  { showFireCells, onToggleFireCells, showRoutes, onToggleRoutes, showForecast, onToggleForecast, forecast, showUnseenKey = false, canFollow, follow, onToggleFollow, onResetCamera, fireCells, onInspectCell },
  ref,
) {
  // The key is collapsed on narrower viewports so it never hides routes or forecast.
  const unseenCount = fireCells.filter((cell) => cell.unseen === true).length;
  const [keyOpen, setKeyOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1700);
  return (
    <div ref={ref} className="scene-legend" role="group" aria-label="Map layers and camera">
      <details
        className="scene-legend__keybox"
        open={keyOpen}
        onToggle={(event) => setKeyOpen(event.currentTarget.open)}
      >
      <summary>Legend</summary>
      <ul className="scene-legend__key">
        <li data-key="observed-fire">
          <span className="scene-legend__swatch" style={{ background: colors.observedFire }} />
          Observed fire
        </li>
        <li>
          <span className="scene-legend__swatch scene-legend__swatch--stale" />
          Stale: faded, hatched; inspect for exact time
        </li>
        <li data-key="forecast">
          <span className="scene-legend__swatch scene-legend__swatch--hatch" />
          Forecast envelope: magenta hatching, simulated time
        </li>
        <li data-key="forecast-unreliable">
          <span className="scene-legend__swatch scene-legend__swatch--hatch-faint" />
          Faint hatching, labelled &quot;unreliable&quot;: forecast unreliable or rebuilding
        </li>
        <li>
          <span className="scene-legend__swatch scene-legend__swatch--route" />
          Route: &gt;&gt; approach · solid work · dashed return
        </li>
        {showUnseenKey ? (
          <li>
            <span className="scene-legend__swatch scene-legend__swatch--unseen" />
            Dashed frame: fire the coordinator has not observed (replay only)
          </li>
        ) : null}
        <li>
          <span className="scene-legend__swatch" style={{ background: colors.refuge }} />
          Refuge
        </li>
      </ul>
      <p className="scene-legend__source">
        Map: {scenarioMap.version}
        {import.meta.env.DEV && scenarioMap.source.kind === "local-snapshot" ? " (local snapshot; scenarios/ has no valid file)" : ""}
      </p>
      </details>
      <div className="scene-legend__controls">
        <label className="scene-legend__toggle">
          <input type="checkbox" checked={showFireCells} onChange={onToggleFireCells} />
          Show fire observations
        </label>
        <label className="scene-legend__toggle">
          <input type="checkbox" checked={showRoutes} onChange={onToggleRoutes} />
          Show planned routes
        </label>
        <label className="scene-legend__toggle">
          <input type="checkbox" checked={showForecast} onChange={onToggleForecast} />
          Show forecast
        </label>
        <p className="scene-legend__forecast" role="status" data-reliability={forecast?.reliability ?? "none"}>
          {forecast ? forecast.headline : "Forecast: not yet built"}
          {forecast?.explanation ? `: ${forecast.explanation}` : ""}
        </p>
        <label className="scene-legend__toggle" title={canFollow ? undefined : "Select a crew to follow it"}>
          <input type="checkbox" checked={canFollow && follow} disabled={!canFollow} onChange={onToggleFollow} />
          Follow selected
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
          <summary>
            {unseenCount > 0
              ? `Fire cells (${fireCells.length - unseenCount} observed, ${unseenCount} not observed, replay only)`
              : `Observed cells (${fireCells.length})`}
          </summary>
          <ul>
            {fireCells.map((cell) => (
              <li key={cell.key}>
                <button type="button" onClick={() => onInspectCell(cell)}>
                  Cell {cell.gridCellIndex}: {cell.burnState}
                  {cell.unseen ? ", not observed by the coordinator" : cell.stale ? ", stale" : ""}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
});
