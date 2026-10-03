import type { CellBurn } from "../trees/treePlacement.js";

/**
 * Ground light/char map (one texel per grid cell, RGBA8). R = fire light
 * reaching the ground, G = char. Built ONLY from observed cells, so
 * unobserved ground stays dark and no unknown fire can be implied
 * (CLAUDE.md: only observed fire is drawn in active mode).
 */
export const FIRE_LIGHT: Record<CellBurn, number> = {
  burning: 1,
  "burning-stale": 0.22, // an old report must not light the ground like a live one
  burned: 0,
};

export const CHAR_AMOUNT: Record<CellBurn, number> = {
  burning: 0.35,
  "burning-stale": 0.35,
  burned: 1,
};

/** Light spreads to neighbours with a smooth radial falloff (cells); softens the pool of light. */
const LIGHT_RADIUS = 3.4;
const RADIUS_CELLS = 3;

function falloff(distance: number): number {
  const t = Math.max(0, 1 - distance / LIGHT_RADIUS);
  return t * t;
}

export function buildFireMap(gridSize: number, burns: ReadonlyMap<number, CellBurn>): Uint8Array {
  const data = new Uint8Array(gridSize * gridSize * 4);
  const light = new Float32Array(gridSize * gridSize);
  const charAmount = new Float32Array(gridSize * gridSize);
  for (const [cell, burn] of burns) {
    const cx = cell % gridSize;
    const cy = Math.floor(cell / gridSize);
    if (cell < 0 || cell >= gridSize * gridSize) continue;
    charAmount[cell] = Math.max(charAmount[cell]!, CHAR_AMOUNT[burn]);
    const strength = FIRE_LIGHT[burn];
    if (strength === 0) continue;
    for (let dy = -RADIUS_CELLS; dy <= RADIUS_CELLS; dy++) {
      for (let dx = -RADIUS_CELLS; dx <= RADIUS_CELLS; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) continue;
        const weight = falloff(Math.hypot(dx, dy));
        const index = y * gridSize + x;
        light[index] = Math.min(1, light[index]! + strength * weight);
      }
    }
  }
  for (let i = 0; i < gridSize * gridSize; i++) {
    data[i * 4] = Math.round(light[i]! * 255);
    data[i * 4 + 1] = Math.round(charAmount[i]! * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}
