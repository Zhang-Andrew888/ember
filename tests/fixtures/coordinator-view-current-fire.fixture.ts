import type { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "./coordinator-view.fixture.js";

/**
 * A second coordinator fixture whose view carries the optional `currentFire` field (#112/#114).
 * `coordinator-view.fixture.ts` stays unchanged and has no currentFire, so it keeps proving that a
 * view without the field is valid. Cells are 64 x 64 grid indices (row * 64 + column), strictly
 * ascending and unique; burning and burned are disjoint.
 *
 * The fire spreads well beyond the six cells the fixture's crews observed, and two of its cells
 * (2825, 2826) are burned out here while the older observations still say "burning": the belief and
 * the current fire disagree, which is exactly what the map must keep apart.
 */
const GRID = 64;

function rect(x0: number, y0: number, x1: number, y1: number): number[] {
  const cells: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(y * GRID + x);
  return cells;
}

const fireArea = rect(9, 38, 16, 45);
const burnedCells = fireArea.filter((cell) => cell % GRID <= 10 && Math.floor(cell / GRID) >= 44);
const burnedSet = new Set(burnedCells);
const burningCells = fireArea.filter((cell) => !burnedSet.has(cell));

export const fixtureCurrentFire: NonNullable<CoordinatorView["currentFire"]> = {
  simTimeMs: fixtureCoordinatorView.simTimeMs,
  burningCells,
  burnedCells,
};

export const fixtureCoordinatorViewWithCurrentFire: CoordinatorView = {
  ...fixtureCoordinatorView,
  currentFire: fixtureCurrentFire,
};
