import { forwardRef, useId, useState } from "react";
import { colors } from "../../styles/colors.js";
import type { ForecastLayer } from "./sceneLayers.js";
import { scenarioMap } from "../../map/activeScenario.js";
import type { CurrentFireLayer, FireCellMarker } from "./sceneEntities.js";
import { formatIncidentClock } from "../../format/time.js";
import { GRID_SIZE } from "../../map/positions.js";
import { gridCellIndexFromRowColumn, isValidGridCellIndex } from "./tileInspection.js";

export interface SceneLegendProps {
  readonly showFireCells: boolean;
  readonly onToggleFireCells: () => void;
  /** Live current-fire layer on/off. Only offered when the feed carries one (`currentFire` not null). */
  readonly showCurrentFire: boolean;
  readonly onToggleCurrentFire: () => void;
  /** Summary of the live current fire; null when the view has none. */
  readonly currentFire: Pick<CurrentFireLayer, "simTimeMs" | "burningCount" | "burnedCount"> | null;
  readonly showRoutes: boolean;
  readonly onToggleRoutes: () => void;
  readonly showForecast: boolean;
  readonly onToggleForecast: () => void;
  readonly forecast: ForecastLayer | null;
  /** Replay with the full fire on: explain the dashed frames. */
  readonly showUnseenKey?: boolean;
  /** Firebreak cells on the map; the key entry shows only when there are some. */
  readonly firebreakCount?: number;
  /** Cells partly cleared; the key entry shows only when there are some. */
  readonly clearingCount?: number;
  /** Fire-line cells ordered but not started; the key entry shows only when there are some. */
  readonly plannedLineCount?: number;
  readonly canFollow: boolean;
  readonly follow: boolean;
  readonly onToggleFollow: () => void;
  readonly onResetCamera: () => void;
  readonly fireCells: FireCellMarker[];
  readonly onInspectCell: (cell: FireCellMarker) => void;
  readonly onInspectMapTile: (gridCellIndex: number) => void;
}

/**
 * Upper scene-corner overlay: layer legend and reset camera
 * (docs/FRONTEND.md). These are inspection/view controls only - never
 * command controls (nothing here issues a task or addresses a crew).
 * Forwards a ref to its root element so SceneView can measure it and keep
 * scene labels from rendering underneath it.
 */
export const SceneLegend = forwardRef<HTMLDivElement, SceneLegendProps>(function SceneLegend(
  {
    showFireCells,
    onToggleFireCells,
    showCurrentFire,
    onToggleCurrentFire,
    currentFire,
    showRoutes,
    onToggleRoutes,
    showForecast,
    onToggleForecast,
    forecast,
    showUnseenKey = false,
    firebreakCount = 0,
    clearingCount = 0,
    plannedLineCount = 0,
    canFollow,
    follow,
    onToggleFollow,
    onResetCamera,
    fireCells,
    onInspectCell,
    onInspectMapTile,
  },
  ref,
) {
  // The key is collapsed on narrower viewports so it never hides routes or forecast.
  const unseenCount = fireCells.filter((cell) => cell.unseen === true).length;
  const [keyOpen, setKeyOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1700);
  const gridSize = scenarioMap.terrain?.gridSize ?? GRID_SIZE;
  const rowInputId = useId();
  const columnInputId = useId();
  const indexInputId = useId();
  const [pickRow, setPickRow] = useState("0");
  const [pickColumn, setPickColumn] = useState("0");
  const [pickIndex, setPickIndex] = useState("0");

  const inspectFromRowColumn = () => {
    const index = gridCellIndexFromRowColumn(Number(pickRow), Number(pickColumn));
    if (index !== null) onInspectMapTile(index);
  };

  const inspectFromIndex = () => {
    const index = Number(pickIndex);
    if (isValidGridCellIndex(index)) onInspectMapTile(index);
  };
  return (
    <div ref={ref} className="scene-legend" role="group" aria-label="Map layers and camera">
      <details
        className="scene-legend__keybox"
        open={keyOpen}
        onToggle={(event) => setKeyOpen(event.currentTarget.open)}
      >
      <summary>Legend</summary>
      <ul className="scene-legend__key">
        {currentFire ? (
          <>
            <li data-key="current-fire">
              <span className="scene-legend__swatch" style={{ background: colors.observedFire }} />
              Current fire: solid orange tiles and flames (live feed, whole map)
            </li>
            <li data-key="current-burned">
              <span className="scene-legend__swatch scene-legend__swatch--burned" />
              Burned out: flat dark tile
            </li>
            <li data-key="observed-belief">
              <span className="scene-legend__swatch scene-legend__swatch--belief" />
              Observed belief: outlined frame, may be old; inspect for time
            </li>
          </>
        ) : (
          <li data-key="observed-fire">
            <span className="scene-legend__swatch" style={{ background: colors.observedFire }} />
            Observed fire
          </li>
        )}
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
        {firebreakCount > 0 ? (
          <li data-key="firebreak">
            <span className="scene-legend__swatch scene-legend__swatch--firebreak" />
            Firebreak: crosshatched cleared ground, fire cannot cross ({firebreakCount} cells)
          </li>
        ) : null}
        {clearingCount > 0 ? (
          <li data-key="clearing">
            <span className="scene-legend__swatch scene-legend__swatch--clearing" />
            Being cleared: crosshatched tile grows as crews clear it; fire slows there ({clearingCount} cells)
          </li>
        ) : null}
        {plannedLineCount > 0 ? (
          <li data-key="planned-line">
            <span className="scene-legend__swatch scene-legend__swatch--planned-line" />
            Fire line ordered: small pale markers, not cleared yet ({plannedLineCount} cells)
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
        {currentFire ? (
          <label className="scene-legend__toggle">
            <input type="checkbox" checked={showCurrentFire} onChange={onToggleCurrentFire} />
            Show current fire
          </label>
        ) : null}
        <label className="scene-legend__toggle">
          <input type="checkbox" checked={showFireCells} onChange={onToggleFireCells} />
          Show fire observations
        </label>
        {currentFire ? (
          <p className="scene-legend__currentfire" role="status">
            Current fire at {formatIncidentClock(currentFire.simTimeMs)} incident time: {currentFire.burningCount} burning,{" "}
            {currentFire.burnedCount} burned
          </p>
        ) : null}
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
      <details className="scene-legend__tile-pick">
        <summary>Inspect map tile</summary>
        <p className="scene-legend__tile-hint">Click the ground on the map, or enter row and column (0–{gridSize - 1}).</p>
        <form
          className="scene-legend__tile-form"
          onSubmit={(event) => {
            event.preventDefault();
            inspectFromRowColumn();
          }}
        >
          <label htmlFor={rowInputId}>
            Row
            <input
              id={rowInputId}
              type="number"
              min={0}
              max={gridSize - 1}
              value={pickRow}
              onChange={(event) => setPickRow(event.target.value)}
            />
          </label>
          <label htmlFor={columnInputId}>
            Column
            <input
              id={columnInputId}
              type="number"
              min={0}
              max={gridSize - 1}
              value={pickColumn}
              onChange={(event) => setPickColumn(event.target.value)}
            />
          </label>
          <button type="submit">Inspect tile</button>
        </form>
        <form
          className="scene-legend__tile-form"
          onSubmit={(event) => {
            event.preventDefault();
            inspectFromIndex();
          }}
        >
          <label htmlFor={indexInputId}>
            Grid index
            <input
              id={indexInputId}
              type="number"
              min={0}
              max={gridSize * gridSize - 1}
              value={pickIndex}
              onChange={(event) => setPickIndex(event.target.value)}
            />
          </label>
          <button type="submit">Inspect by index</button>
        </form>
      </details>
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
