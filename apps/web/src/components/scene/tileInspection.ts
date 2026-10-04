import { formatIncidentClock } from "../../format/time.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { GRID_SIZE } from "../../map/positions.js";
import type { SceneEntities, FireCellMarker, FireCellSource } from "./sceneEntities.js";
import { inspectFireCell } from "./fireInspection.js";

/**
 * Pointer or keyboard selection of any in-bounds map cell. A fire-cell selection keeps the cell's
 * identity and source, never the marker object, so the panel always shows that source's latest data.
 */
export type MapInspectionTarget =
  | { readonly kind: "fire-cell"; readonly gridCellIndex: number; readonly source: FireCellSource }
  | { readonly kind: "terrain"; readonly gridCellIndex: number };

export function fireCellTarget(cell: Pick<FireCellMarker, "gridCellIndex" | "source">): MapInspectionTarget {
  return { kind: "fire-cell", gridCellIndex: cell.gridCellIndex, source: cell.source };
}

/** Latest marker for a cell from one source in the entities on screen now. */
function markerFromSource(
  entities: Pick<SceneEntities, "fireCells" | "currentFire">,
  gridCellIndex: number,
  source: FireCellSource,
): FireCellMarker | null {
  const pool = source === "current-fire" ? (entities.currentFire?.cells ?? []) : entities.fireCells;
  return pool.find((cell) => cell.gridCellIndex === gridCellIndex && cell.source === source) ?? null;
}

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
  const index = target.gridCellIndex;
  if (target.kind === "fire-cell") {
    const latest = markerFromSource(entities, index, target.source);
    if (latest !== null) return fromFireCell(latest, simTimeMs);
  }

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

export type GridInputResult =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly error: string };

/** A whole number in [0, max], or null when the field is blank or not a whole number. */
function parseWhole(raw: string): number | null | "blank" {
  const text = raw.trim();
  if (text === "") return "blank";
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

/** Legend row/column form: a blank field is an error, never row or column 0. */
export function parseGridRowColumnInput(rowRaw: string, columnRaw: string): GridInputResult {
  const { size } = gridDimensions();
  const range = `a whole number from 0 to ${size - 1}`;
  const row = parseWhole(rowRaw);
  const column = parseWhole(columnRaw);
  if (row === "blank" || column === "blank") return { ok: false, error: `Enter both a row and a column (${range}).` };
  if (row === null || row >= size) return { ok: false, error: `Row must be ${range}.` };
  if (column === null || column >= size) return { ok: false, error: `Column must be ${range}.` };
  return { ok: true, index: row * size + column };
}

/** Legend grid-index form: a blank field is an error, never cell 0. */
export function parseGridIndexInput(raw: string): GridInputResult {
  const { size } = gridDimensions();
  const max = size * size - 1;
  const index = parseWhole(raw);
  if (index === "blank") return { ok: false, error: `Enter a grid index from 0 to ${max}.` };
  if (index === null || index > max) return { ok: false, error: `Grid index must be a whole number from 0 to ${max}.` };
  return { ok: true, index };
}
