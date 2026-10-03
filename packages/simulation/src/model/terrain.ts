import { SIM_DEFAULTS } from "./constants.js";
import { cellCenter } from "./map.js";
import { streamRng } from "./rng.js";

export interface Terrain {
  /** Fuel multiplier per grid cell, within SIM_DEFAULTS.fuelRange. */
  readonly fuel: Float64Array;
  /** Smooth synthetic height field in meters per grid cell. */
  readonly height: Float64Array;
}

/** Authored, public, smooth fuel and height layers from a terrain seed. */
export function createTerrain(terrainSeed: string): Terrain {
  const rng = streamRng(terrainSeed, "terrain");
  const phase = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  const n = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.gridSize;
  const fuel = new Float64Array(n);
  const height = new Float64Array(n);
  const [fuelMin, fuelMax] = SIM_DEFAULTS.fuelRange;
  for (let i = 0; i < n; i++) {
    const { x, y } = cellCenter(i);
    height[i] =
      30 * Math.sin(x / 310 + phase[0]!) * Math.cos(y / 270 + phase[1]!) +
      25 * Math.sin((x + y) / 410 + phase[2]!);
    const smooth = 1 + 0.35 * Math.sin(x / 190 + phase[3]!) * Math.sin(y / 230 + phase[4]!);
    const grain = rng.range(-0.08, 0.08);
    fuel[i] = Math.min(fuelMax, Math.max(fuelMin, smooth + grain));
  }
  return { fuel, height };
}
