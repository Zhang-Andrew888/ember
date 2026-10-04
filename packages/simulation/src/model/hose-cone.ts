/** Whether a burning cell is within hose reach and the crew's forward cone. */
export function hoseCellInCone(
  originX: number,
  originY: number,
  headingX: number,
  headingY: number,
  cellX: number,
  cellY: number,
  maxDistM: number,
  minDot: number,
): boolean {
  const vx = cellX - originX;
  const vy = cellY - originY;
  const dist = Math.hypot(vx, vy);
  if (dist > maxDistM) return false;
  if (dist < 1e-6) return true;
  const dot = (vx / dist) * headingX + (vy / dist) * headingY;
  return dot >= minDot;
}
