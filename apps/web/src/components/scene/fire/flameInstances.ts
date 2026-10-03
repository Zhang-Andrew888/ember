import type { FireCellMarker } from "../sceneEntities.js";
import { freshness } from "../staleness.js";

export interface FlameInstance {
  readonly x: number;
  readonly z: number;
  readonly seed: number;
  /** 0..1 brightness; fresh live fire is 1, stale is a faint ghost. */
  readonly intensity: number;
  readonly stale: boolean;
  /** Height in scene units. */
  readonly height: number;
  readonly width: number;
}

const STALE_INTENSITY = 0.5;

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Flame cards for observed burning cells only. `burned` and `unburned`
 * produce none (burned ground shows as char, handled by the ground map), so
 * the scene can never draw fire the coordinator has not been told about.
 */
export function buildFlameInstances(
  cells: readonly FireCellMarker[],
  cardsPerCell: number,
  cellSize: number,
): FlameInstance[] {
  const out: FlameInstance[] = [];
  for (const cell of cells) {
    if (cell.burnState !== "burning") continue;
    for (let i = 0; i < cardsPerCell; i++) {
      const seed = hash01(cell.gridCellIndex * 7.13 + i * 3.7);
      const angle = hash01(seed * 91.7) * Math.PI * 2;
      const radius = cardsPerCell === 1 ? 0 : cellSize * 0.22 * hash01(seed * 17.3);
      const sizeJitter = 0.75 + hash01(seed * 53.1) * 0.5;
      out.push({
        x: cell.position.x + Math.cos(angle) * radius,
        z: cell.position.z + Math.sin(angle) * radius,
        seed,
        // A stale ghost fades further the older it is - it never looks current.
        intensity: cell.stale ? STALE_INTENSITY * freshness(cell.ageMs, true).opacity : 1,
        stale: cell.stale,
        height: cellSize * 1.9 * sizeJitter,
        width: cellSize * 1.0 * sizeJitter,
      });
    }
  }
  return out;
}

export interface EmberParticle {
  readonly x: number;
  readonly z: number;
  readonly seed: number;
}

/** Rising embers only above fresh (non-stale) burning cells. */
export function buildEmberParticles(cells: readonly FireCellMarker[], perCell: number): EmberParticle[] {
  const out: EmberParticle[] = [];
  for (const cell of cells) {
    if (cell.burnState !== "burning" || cell.stale) continue;
    for (let i = 0; i < perCell; i++) {
      out.push({ x: cell.position.x, z: cell.position.z, seed: hash01(cell.gridCellIndex * 3.3 + i * 11.1) });
    }
  }
  return out;
}
