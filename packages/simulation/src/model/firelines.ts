import type { CompassDirection } from "@ember/domain";
import { SIM_DEFAULTS } from "./constants.js";
import { cellCenter, type RoadIndex } from "./map.js";

/**
 * Fire lines: straight runs of grid cells between two map points, cleared by crews. Cells are an
 * 8-connected raster; that seals because the fire model blocks diagonal steps between cleared
 * corner cells. Shared by the simulator, crew planning and the order gateway so all agree on the
 * cells and on how a spoken order becomes two points.
 */

const N = SIM_DEFAULTS.gridSize;
const MAP_M = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.cellMeters;

/** Length of a line whose order names none. */
export const DEFAULT_LINE_LENGTH_M = 200;

type XY = { readonly x: number; readonly y: number };

const BEARINGS: Record<CompassDirection, number> = {
  north: 0,
  northeast: 45,
  east: 90,
  southeast: 135,
  south: 180,
  southwest: 225,
  west: 270,
  northwest: 315,
};

/** Degrees clockwise from north; world north is increasing map y, east increasing x. */
export function compassBearing(direction: CompassDirection): number {
  return BEARINGS[direction];
}

/** Unit vector (x east, y north) for a bearing, with trig noise rounded away (sin 180° is not 1e-16). */
function unit(bearingDeg: number): XY {
  const rad = (bearingDeg * Math.PI) / 180;
  const clean = (v: number): number => Math.round(v * 1e12) / 1e12;
  return { x: clean(Math.sin(rad)), y: clean(Math.cos(rad)) };
}

const onMap = (p: XY): boolean => p.x >= 0 && p.x <= MAP_M && p.y >= 0 && p.y <= MAP_M;

/** A place moved `offsetMeters` toward `direction`; null when that lands off the map. */
export function anchorPoint(place: XY, offsetMeters: number, direction: CompassDirection): XY | null {
  const u = unit(compassBearing(direction));
  const p = { x: place.x + u.x * offsetMeters, y: place.y + u.y * offsetMeters };
  return onMap(p) ? p : null;
}

/**
 * The far end of a line from `start` along `bearingDeg`. A finite length is shortened where it would
 * leave the map, and `clampedToEdge` says so. `"edge"` runs exactly to the map edge and is never
 * reported as shortened.
 */
export function lineEnd(start: XY, bearingDeg: number, lengthM: number | "edge"): { end: XY; clampedToEdge: boolean } {
  const u = unit(bearingDeg);
  // Distance along the bearing at which each axis leaves [0, MAP_M].
  const toWall = (from: number, step: number): number => (step > 0 ? (MAP_M - from) / step : step < 0 ? (0 - from) / step : Infinity);
  const room = Math.max(0, Math.min(toWall(start.x, u.x), toWall(start.y, u.y)));
  const length = lengthM === "edge" ? room : Math.min(lengthM, room);
  const end = {
    x: Math.min(MAP_M, Math.max(0, start.x + u.x * length)),
    y: Math.min(MAP_M, Math.max(0, start.y + u.y * length)),
  };
  return { end, clampedToEdge: lengthM !== "edge" && lengthM > room };
}

/** Cell containing a point; the map's far edges (x or y of 1600 m) belong to the last row and column. */
function cellOf(p: XY): number | null {
  if (!onMap(p)) return null;
  const gx = Math.min(N - 1, Math.floor(p.x / SIM_DEFAULTS.cellMeters));
  const gy = Math.min(N - 1, Math.floor(p.y / SIM_DEFAULTS.cellMeters));
  return gy * N + gx;
}

/** Cells in the canonical direction (lower end cell first); Bresenham is not symmetric on ties. */
function canonicalCells(a: number, b: number): number[] {
  let x = a % N;
  let y = (a - x) / N;
  const x1 = b % N;
  const y1 = (b - x1) / N;
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  const out: number[] = [];
  for (;;) {
    out.push(y * N + x);
    if (x === x1 && y === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Cells from `start` to `end`, in that order, both ends included; reversing the ends reverses the cells. */
export function firelineCells(start: XY, end: XY): number[] {
  const a = cellOf(start);
  const b = cellOf(end);
  if (a === null || b === null) return [];
  return a <= b ? canonicalCells(a, b) : canonicalCells(b, a).reverse();
}

/** One id per unordered pair of end cells, so crews working from either end share a line. */
export function firelineId(start: XY, end: XY): string {
  const a = cellOf(start);
  const b = cellOf(end);
  if (a === null || b === null) return "line:off-map";
  return a <= b ? `line:${a}~${b}` : `line:${b}~${a}`;
}

/** The part of a line, in working order from `start`, that a crew at road node `workNodeId` can reach. */
export function reachableFirelineCells(
  road: RoadIndex,
  workNodeId: string,
  start: XY,
  end: XY,
  reachM = SIM_DEFAULTS.lineReachM,
): number[] {
  const p = road.nodePoint(workNodeId as never);
  return firelineCells(start, end).filter((cell) => {
    const c = cellCenter(cell);
    return Math.hypot(c.x - p.x, c.y - p.y) <= reachM;
  });
}
