import type { ScenarioTerrain } from "../../../map/scenarioSchema.js";
import { SCENE_SIZE } from "../../../map/worldScale.js";
import { GRID_SIZE } from "../../../map/positions.js";

/**
 * Terrain elevation and vegetation sampled in scene units. Heights are the
 * scenario's public height layer (metres), shifted so the lowest point is 0
 * and scaled by a vertical factor (gentle relief: the scene is a tilted
 * model, not a survey). A scenario without terrain yields a flat field.
 */
export const VERTICAL_SCALE = 0.9;

export interface HeightField {
  readonly gridSize: number;
  /** Scene units across one grid cell. */
  readonly cellSize: number;
  /** Corner heights, (gridSize + 1)^2, row-major (z rows). Scene units, >= 0. */
  readonly corners: Float32Array;
  readonly maxHeight: number;
  /** Cell-centre fuel/vegetation density, gridSize^2 (1 = average). */
  readonly fuel: Float32Array;
  /** Bilinear ground height at a scene (x, z); clamps outside the field. */
  groundY(x: number, z: number): number;
  /** Cell-centre scene position for a flat grid index. */
  cellCenter(index: number): { x: number; z: number };
  /** Grid index containing a scene (x, z), or null outside. */
  cellIndexAt(x: number, z: number): number | null;
  /** Ground height at a cell centre. */
  cellHeight(index: number): number;
}

function clampIndex(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

export function createHeightField(terrain: ScenarioTerrain | null): HeightField {
  const gridSize = terrain?.gridSize ?? GRID_SIZE;
  const cells = gridSize * gridSize;
  const cellSize = SCENE_SIZE / gridSize;

  const cellHeights = new Float32Array(cells);
  const fuel = new Float32Array(cells).fill(1);
  if (terrain) {
    let min = Infinity;
    for (const h of terrain.height) min = Math.min(min, h);
    for (let i = 0; i < cells; i++) {
      cellHeights[i] = (terrain.height[i]! - min) * VERTICAL_SCALE;
      fuel[i] = terrain.fuel[i]!;
    }
  }

  const stride = gridSize + 1;
  const corners = new Float32Array(stride * stride);
  let maxHeight = 0;
  for (let cz = 0; cz <= gridSize; cz++) {
    for (let cx = 0; cx <= gridSize; cx++) {
      let sum = 0;
      let count = 0;
      for (const dz of [-1, 0]) {
        for (const dx of [-1, 0]) {
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= gridSize || z >= gridSize) continue;
          sum += cellHeights[z * gridSize + x]!;
          count++;
        }
      }
      const value = count > 0 ? sum / count : 0;
      corners[cz * stride + cx] = value;
      maxHeight = Math.max(maxHeight, value);
    }
  }

  const half = SCENE_SIZE / 2;
  return {
    gridSize,
    cellSize,
    corners,
    maxHeight,
    fuel,
    groundY(x, z) {
      const gx = clampIndex((x + half) / cellSize, gridSize);
      const gz = clampIndex((z + half) / cellSize, gridSize);
      const x0 = Math.min(gridSize - 1, Math.floor(gx));
      const z0 = Math.min(gridSize - 1, Math.floor(gz));
      const tx = gx - x0;
      const tz = gz - z0;
      const h00 = corners[z0 * stride + x0]!;
      const h10 = corners[z0 * stride + x0 + 1]!;
      const h01 = corners[(z0 + 1) * stride + x0]!;
      const h11 = corners[(z0 + 1) * stride + x0 + 1]!;
      return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
    },
    cellCenter(index) {
      const gx = index % gridSize;
      const gz = Math.floor(index / gridSize);
      return { x: (gx + 0.5) * cellSize - half, z: (gz + 0.5) * cellSize - half };
    },
    cellIndexAt(x, z) {
      const gx = Math.floor((x + half) / cellSize);
      const gz = Math.floor((z + half) / cellSize);
      if (gx < 0 || gz < 0 || gx >= gridSize || gz >= gridSize) return null;
      return gz * gridSize + gx;
    },
    cellHeight(index) {
      return cellHeights[index] ?? 0;
    },
  };
}
