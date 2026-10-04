import { SIM_DEFAULTS } from "./constants.js";
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

/** Every cell that can never burn on this map: refuge protection areas plus firebreaks. */
export function nonburnableCells(road: RoadIndex): Set<number> {
  const out = refugeCells(road, SIM_DEFAULTS.refugeRadiusM);
  for (const cell of road.map.firebreakCells ?? []) out.add(cell);
  return out;
}
