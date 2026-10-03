import { cellsWithin } from "./fire.js";
import type { RoadIndex } from "./map.js";

/** Cells within the refuge protection radius; these never burn. */
export function refugeCells(road: RoadIndex, radiusM: number): Set<number> {
  const out = new Set<number>();
  for (const refuge of road.map.refuges) {
    const p = road.nodePoint(refuge.nodeId);
    for (const cell of cellsWithin(p.x, p.y, radiusM)) out.add(cell);
  }
  return out;
}
