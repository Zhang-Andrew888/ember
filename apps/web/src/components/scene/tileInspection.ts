import { formatIncidentClock } from "../../format/time.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { GRID_SIZE } from "../../map/positions.js";
import type { SceneEntities, FireCellMarker } from "./sceneEntities.js";
import { inspectFireCell } from "./fireInspection.js";

/** Pointer or keyboard selection of any in-bounds map cell. */
export type MapInspectionTarget =
  | { readonly kind: "fire-cell"; readonly cell: FireCellMarker }
  | { readonly kind: "terrain"; readonly gridCellIndex: number };

export interface TileInspection {
  readonly gridCellIndex: number;
  readonly row: number;
  readonly column: number;
  readonly location: string;
  readonly source: string;
  readonly state: string;
  readonly timeHeading: string | null;
  readonly time: string | null;
}

function gridDimensions(): { readonly size: number; readonly cellMeters: number } {
  const size = scenarioMap.terrain?.gridSize ?? GRID_SIZE;
  const cellMeters = scenarioMap.terrain?.cellMeters ?? 25;
  return { size, cellMeters };
}

export function gridCellRowColumn(gridCellIndex: number): { readonly row: number; readonly column: number } {
  const { size } = gridDimensions();
  return { row: Math.floor(gridCellIndex / size), column: gridCellIndex % size };
}

export function formatTileLocation(gridCellIndex: number): string {
  const { row, column } = gridCellRowColumn(gridCellIndex);
  const { cellMeters } = gridDimensions();
  return `Row ${row}, column ${column} (${(column + 0.5) * cellMeters} m east, ${(row + 0.5) * cellMeters} m north)`;
}

/** Coordinator-authorized fire knowledge for a cell; never replay-only truth. */
export function coordinatorFireMarker(
  entities: Pick<SceneEntities, "fireCells" | "currentFire">,
  gridCellIndex: number,
): FireCellMarker | null {
  const current = entities.currentFire?.cells.find((cell) => cell.gridCellIndex === gridCellIndex);
  if (current !== undefined) return current;
  const observed = entities.fireCells.find(
    (cell) => cell.gridCellIndex === gridCellIndex && cell.source !== "replay-truth",
  );
  return observed ?? null;
}

function neverObservedInspection(gridCellIndex: number): TileInspection {
  const { row, column } = gridCellRowColumn(gridCellIndex);
  return {
    gridCellIndex,
    row,
    column,
    location: formatTileLocation(gridCellIndex),
    source: "Coordinator feed",
    state: "No fire reported for this cell",
    timeHeading: null,
    time: null,
  };
}

function fromFireCell(cell: FireCellMarker, simTimeMs: number | null): TileInspection {
  const fire = inspectFireCell(cell, simTimeMs);
  const { row, column } = gridCellRowColumn(cell.gridCellIndex);
  return {
    gridCellIndex: cell.gridCellIndex,
    row,
    column,
    location: formatTileLocation(cell.gridCellIndex),
    source: fire.source,
    state: fire.state,
    timeHeading: fire.time === null ? null : fire.timeHeading,
    time: fire.time,
  };
}

/**
 * When the live current-fire layer exists, cells absent from burning and burned lists are unburned at feed time.
 */
function currentFireUnburned(gridCellIndex: number, simTimeMs: number): TileInspection {
  const { row, column } = gridCellRowColumn(gridCellIndex);
  return {
    gridCellIndex,
    row,
    column,
    location: formatTileLocation(gridCellIndex),
    source: "Current fire (live coordinator feed)",
    state: "unburned",
    timeHeading: "Feed time",
    time: `${formatIncidentClock(simTimeMs)} incident time`,
  };
}

export function inspectMapTile(
  target: MapInspectionTarget,
  entities: Pick<SceneEntities, "fireCells" | "currentFire">,
  simTimeMs: number | null,
): TileInspection {
  if (target.kind === "fire-cell") {
    return fromFireCell(target.cell, simTimeMs);
  }

  const index = target.gridCellIndex;
  const marker = coordinatorFireMarker(entities, index);
  if (marker !== null) return fromFireCell(marker, simTimeMs);

  if (entities.currentFire !== null) {
    const feedTime = entities.currentFire.simTimeMs;
    return currentFireUnburned(index, feedTime);
  }

  return neverObservedInspection(index);
}

export function isValidGridCellIndex(index: number): boolean {
  const { size } = gridDimensions();
  return Number.isInteger(index) && index >= 0 && index < size * size;
}

/** Parse row/column from the legend's accessible picker. */
export function gridCellIndexFromRowColumn(row: number, column: number): number | null {
  const { size } = gridDimensions();
  if (!Number.isInteger(row) || !Number.isInteger(column)) return null;
  if (row < 0 || column < 0 || row >= size || column >= size) return null;
  return row * size + column;
}
