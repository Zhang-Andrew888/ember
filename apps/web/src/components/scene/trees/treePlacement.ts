import type { HeightField } from "../terrain/heightField.js";
import type { FireCellMarker } from "../sceneEntities.js";
import { fuelDensity } from "../terrain/terrainColor.js";

export interface TreeInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Flat grid cell this tree stands in (so observed fire can char it). */
  readonly cell: number;
  /** 0 = spruce, 1 = pine. */
  readonly species: 0 | 1;
  readonly scale: number;
  readonly rotation: number;
  /** Brightness multiplier, ~0.85..1.15. */
  readonly tint: number;
}

export interface PlacementOptions {
  readonly field: HeightField;
  /** True where trees must not grow (roads, sites, refuges). */
  readonly blocked: (x: number, z: number) => boolean;
  readonly waterCells: ReadonlySet<number>;
  /** Tier multiplier (QualityConfig.treeDensity). */
  readonly densityFactor: number;
  /** Trees per cell at maximum vegetation density and factor 1. */
  readonly maxPerCell?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic tree layout: the same field always grows the same trees.
 * Density follows the scenario's vegetation (fuel) layer; higher ground
 * favours spruce, lower ground pine.
 */
export function placeTrees(options: PlacementOptions): TreeInstance[] {
  const { field, blocked, waterCells, densityFactor, maxPerCell = 4 } = options;
  const trees: TreeInstance[] = [];
  for (let cell = 0; cell < field.gridSize ** 2; cell++) {
    if (waterCells.has(cell)) continue;
    const density = fuelDensity(field.fuel[cell]!);
    const rng = mulberry32(cell * 2654435761 + 17);
    const count = Math.floor(density * maxPerCell * densityFactor + rng());
    const centre = field.cellCenter(cell);
    const elevation01 = field.maxHeight > 0 ? field.cellHeight(cell) / field.maxHeight : 0;
    for (let i = 0; i < count; i++) {
      const x = centre.x + (rng() - 0.5) * field.cellSize * 0.9;
      const z = centre.z + (rng() - 0.5) * field.cellSize * 0.9;
      const species: 0 | 1 = rng() < 0.35 + elevation01 * 0.5 ? 0 : 1;
      const scale = 0.7 + rng() * 0.7;
      const rotation = rng() * Math.PI * 2;
      const tint = 0.85 + rng() * 0.3;
      if (blocked(x, z)) continue;
      trees.push({ x, y: field.groundY(x, z), z, cell, species, scale, rotation, tint });
    }
  }
  return trees;
}

export type CellBurn = "burning" | "burning-stale" | "burned";

/** Char multipliers: observed fire darkens the trees standing in that cell. */
export const CHAR: Record<CellBurn, number> = {
  burning: 0.22,
  "burning-stale": 0.45,
  burned: 0.12,
};

export function treeBrightness(tree: TreeInstance, burn: CellBurn | undefined): number {
  return tree.tint * (burn ? CHAR[burn] : 1);
}

/** Observed fire only: what the coordinator has actually been told, never the truth. */
export function burnByCell(cells: readonly Pick<FireCellMarker, "gridCellIndex" | "burnState" | "stale">[]): Map<number, CellBurn> {
  const result = new Map<number, CellBurn>();
  for (const cell of cells) {
    if (cell.burnState === "burning") result.set(cell.gridCellIndex, cell.stale ? "burning-stale" : "burning");
    else if (cell.burnState === "burned") result.set(cell.gridCellIndex, "burned");
  }
  return result;
}

