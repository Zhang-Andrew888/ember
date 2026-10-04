import { cellIndexOf } from "./map.js";
import { SIM_DEFAULTS } from "./constants.js";

/** Map extent in meters (square grid). */
export function mapExtentM(): number {
  return SIM_DEFAULTS.gridSize * SIM_DEFAULTS.cellMeters;
}

/**
 * Explicit traversability rule (#120): off-road is allowed only inside the public map bounds.
 * (No arbitrary travel through cells outside the scenario grid.)
 */
export function offRoadPointTraversable(x: number, y: number): boolean {
  const max = mapExtentM();
  return x >= 0 && y >= 0 && x <= max && y <= max && cellIndexOf(x, y) !== null;
}

/** Sample the segment; every sample must stay traversable. */
export function offRoadSegmentTraversable(fromX: number, fromY: number, toX: number, toY: number): boolean {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const steps = Math.max(1, Math.ceil(dist / (SIM_DEFAULTS.cellMeters / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    if (!offRoadPointTraversable(x, y)) return false;
  }
  return true;
}

export function offRoadSegmentLengthM(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.hypot(toX - fromX, toY - fromY);
}
