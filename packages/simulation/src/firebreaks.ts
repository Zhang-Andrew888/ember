import { SIM_DEFAULTS, cellIndexOf } from "./model/index.js";
import type { SimScenario } from "./scenario.js";

/**
 * Hand-placed firebreak layouts for trying firebreaks before crews can build them. The cells come
 * from the Phase 0 feasibility runs (firebreak-feasibility.test.ts) on the synthetic scenario.
 */
export const FIREBREAK_PRESETS = ["head-line", "ridge-ring", "both"] as const;
export type FirebreakPreset = (typeof FIREBREAK_PRESETS)[number];

const N = SIM_DEFAULTS.gridSize;

export function isFirebreakPreset(value: string): value is FirebreakPreset {
  return (FIREBREAK_PRESETS as readonly string[]).includes(value);
}

/**
 * Grid cells for a preset, sorted and unique.
 * - `head-line`: one cell wide at x = 1000-1025 m, from below the fire's southern reach to the
 *   map's north edge, across the head of the eastward run (40 cells).
 * - `ridge-ring`: a ring two cells out around the Ridge Cabins site node (16 cells).
 */
export function firebreakPresetCells(scenario: SimScenario, preset: FirebreakPreset): number[] {
  const cells = new Set<number>();
  if (preset === "head-line" || preset === "both") {
    for (let gy = 24; gy < N; gy++) cells.add(gy * N + 40);
  }
  if (preset === "ridge-ring" || preset === "both") {
    for (const cell of ringAroundSite(scenario, "site-a", 2)) cells.add(cell);
  }
  return [...cells].sort((a, b) => a - b);
}

/** The scenario with these firebreak cells added to its map. */
export function withFirebreaks(scenario: SimScenario, cells: readonly number[]): SimScenario {
  const merged = new Set([...(scenario.map.firebreakCells ?? []), ...cells]);
  return { ...scenario, map: { ...scenario.map, firebreakCells: [...merged].sort((a, b) => a - b) } };
}

function ringAroundSite(scenario: SimScenario, siteId: string, radius: number): number[] {
  const site = scenario.map.sites.find((s) => s.id === siteId);
  const node = scenario.map.nodes.find((n) => n.id === site?.nodeId);
  if (node === undefined) return [];
  const center = cellIndexOf(node.x, node.y);
  if (center === null) return [];
  const cx = center % N;
  const cy = (center - cx) / N;
  const out: number[] = [];
  for (let gy = cy - radius; gy <= cy + radius; gy++) {
    for (let gx = cx - radius; gx <= cx + radius; gx++) {
      if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
      if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) === radius) out.push(gy * N + gx);
    }
  }
  return out;
}
