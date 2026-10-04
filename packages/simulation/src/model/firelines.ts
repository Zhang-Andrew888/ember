import { SIM_DEFAULTS } from "./constants.js";
import { cellCenter, cellIndexOf, type RoadIndex } from "./map.js";

/**
 * Fire lines: straight runs of grid cells between two map nodes, cleared by crews. Cells are an
 * 8-connected raster; that seals because the fire model blocks diagonal steps between cleared
 * corner cells. Shared by the simulator and crew planning so both agree on the cells.
 */

const N = SIM_DEFAULTS.gridSize;

/** One id per unordered pair of end nodes, so crews working from either end share a line. */
export function firelineId(a: string, b: string): string {
  return a < b ? `line:${a}~${b}` : `line:${b}~${a}`;
}

/** Cells from node `from` to node `to`, in that order (Bresenham, both ends included). */
export function firelineCells(road: RoadIndex, from: string, to: string): number[] {
  const a = road.nodePoint(from as never);
  const b = road.nodePoint(to as never);
  const start = cellIndexOf(a.x, a.y);
  const end = cellIndexOf(b.x, b.y);
  if (start === null || end === null) return [];
  let x = start % N;
  let y = (start - x) / N;
  const x1 = end % N;
  const y1 = (end - x1) / N;
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

/** The part of a line, in working order, that a crew at node `from` can reach. */
export function reachableFirelineCells(road: RoadIndex, from: string, to: string, reachM = SIM_DEFAULTS.lineReachM): number[] {
  const p = road.nodePoint(from as never);
  return firelineCells(road, from, to).filter((cell) => {
    const c = cellCenter(cell);
    return Math.hypot(c.x - p.x, c.y - p.y) <= reachM;
  });
}
