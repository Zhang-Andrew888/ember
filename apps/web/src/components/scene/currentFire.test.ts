import { describe, expect, it } from "vitest";
import type { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView as rawFixture } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import {
  fixtureCoordinatorViewWithCurrentFire as rawWithFire,
  fixtureCurrentFire,
} from "../../../../../tests/fixtures/coordinator-view-current-fire.fixture.js";
import { adaptToScenarioIds } from "../../net/mockBase.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { buildSceneEntities, litFireCells } from "./sceneEntities.js";
import { mergeTruthCells } from "../../replay/recording.js";
import { inspectFireCell } from "./fireInspection.js";

// The frozen fixtures use placeholder ids; the adapter maps them onto the real scenario.
const base = adaptToScenarioIds(rawFixture);
const withFire = adaptToScenarioIds(rawWithFire);

describe("issue #114 - current fire becomes scene entities", () => {
  const entities = buildSceneEntities(withFire, scenarioMap);

  it("the separate fixture really has currentFire and the original fixture does not", () => {
    expect(rawWithFire.currentFire).toBeDefined();
    expect(rawFixture.currentFire).toBeUndefined();
  });

  it("builds a marker for every burning and burned cell of the feed, and only those", () => {
    const layer = entities.currentFire!;
    expect(layer.cells).toHaveLength(fixtureCurrentFire.burningCells.length + fixtureCurrentFire.burnedCells.length);
    expect(layer.burningCount).toBe(fixtureCurrentFire.burningCells.length);
    expect(layer.burnedCount).toBe(fixtureCurrentFire.burnedCells.length);
    expect(layer.cells.filter((c) => c.burnState === "burning").map((c) => c.gridCellIndex)).toEqual(fixtureCurrentFire.burningCells);
    expect(layer.cells.filter((c) => c.burnState === "burned").map((c) => c.gridCellIndex)).toEqual(fixtureCurrentFire.burnedCells);
  });

  it("shows far more fire than the six cells the crews observed (not only observedCells)", () => {
    expect(entities.fireCells).toHaveLength(6);
    expect(entities.currentFire!.cells.length).toBeGreaterThan(entities.fireCells.length * 5);
    const observed = new Set(entities.fireCells.map((c) => c.gridCellIndex));
    expect(entities.currentFire!.cells.some((c) => !observed.has(c.gridCellIndex))).toBe(true);
  });

  it("builds the current fire even when nothing has been observed", () => {
    const entitiesNoObs = buildSceneEntities({ ...withFire, observedCells: [] }, scenarioMap);
    expect(entitiesNoObs.fireCells).toHaveLength(0);
    expect(entitiesNoObs.currentFire!.cells).toHaveLength(entities.currentFire!.cells.length);
  });

  it("marks cells as current fire, on the feed's simulation time, never stale", () => {
    for (const cell of entities.currentFire!.cells) {
      expect(cell.source).toBe("current-fire");
      expect(cell.stale).toBe(false);
      expect(cell.lastObservedAt).toBe(fixtureCurrentFire.simTimeMs);
      expect(cell.ageMs).toBe(0);
    }
    expect(entities.currentFire!.simTimeMs).toBe(fixtureCurrentFire.simTimeMs);
  });

  it("keeps old observations as their own cells, marked observed, apart from the current fire", () => {
    expect(entities.fireCells.every((c) => c.source === "observed")).toBe(true);
    // The belief is old: crews saw 2825 burning, but the feed says it has burned out.
    const belief = entities.fireCells.find((c) => c.gridCellIndex === 2825)!;
    const actual = entities.currentFire!.cells.find((c) => c.gridCellIndex === 2825)!;
    expect(belief.burnState).toBe("burning");
    expect(actual.burnState).toBe("burned");
  });

  it("places the first and last grid cells on the map", () => {
    const edge = buildSceneEntities(
      { ...base, currentFire: { simTimeMs: base.simTimeMs, burningCells: [0], burnedCells: [4095] } },
      scenarioMap,
    );
    const [first, last] = edge.currentFire!.cells;
    expect(Number.isFinite(first!.position.x) && Number.isFinite(first!.position.z)).toBe(true);
    expect(last!.position.x).toBeGreaterThan(first!.position.x);
    expect(last!.position.z).toBeGreaterThan(first!.position.z);
  });

  it("handles an empty fire: a layer is present with no cells", () => {
    const empty = buildSceneEntities(
      { ...base, currentFire: { simTimeMs: base.simTimeMs, burningCells: [], burnedCells: [] } },
      scenarioMap,
    );
    expect(empty.currentFire).not.toBeNull();
    expect(empty.currentFire!.cells).toEqual([]);
  });
});

describe("issue #114 - a view without currentFire stays valid and shows no fake fire", () => {
  it("has no current-fire layer, and observed cells are lit exactly as before", () => {
    const entities = buildSceneEntities(base, scenarioMap);
    expect(entities.currentFire).toBeNull();
    expect(entities.fireCells).toHaveLength(6);
    expect(litFireCells(entities, { currentFire: true, observed: true })).toBe(entities.fireCells);
  });

  it("shows nothing in the briefing phase even if a view carried currentFire", () => {
    expect(buildSceneEntities(withFire, scenarioMap, { phase: "briefing" }).currentFire).toBeNull();
  });
});

describe("issue #114 - layers and toggles", () => {
  const entities = buildSceneEntities(withFire, scenarioMap);

  it("lights the current fire, not the old observations, when both exist", () => {
    const lit = litFireCells(entities, { currentFire: true, observed: true });
    expect(lit).toHaveLength(entities.currentFire!.cells.length);
    expect(lit.every((c) => c.source === "current-fire")).toBe(true);
  });

  it("the current-fire and observation toggles are independent", () => {
    expect(litFireCells(entities, { currentFire: false, observed: true })).toEqual([]);
    expect(litFireCells(entities, { currentFire: true, observed: false })).toHaveLength(entities.currentFire!.cells.length);
    expect(litFireCells(entities, { currentFire: false, observed: false })).toEqual([]);
  });

  it("replay-only unseen truth cells still light with the observation toggle, and are skipped when the current fire already shows them", () => {
    const truth = { timeMs: 90_000, burning: [3000, fixtureCurrentFire.burningCells[0]!], burned: [] };
    const shownByFeed = new Set(entities.currentFire!.cells.map((c) => c.gridCellIndex));
    const merged = mergeTruthCells(entities.fireCells, truth, scenarioMap, shownByFeed);
    const unseen = merged.filter((c) => c.source === "replay-truth");
    expect(unseen.map((c) => c.gridCellIndex)).toEqual([3000]);
    const lit = litFireCells({ ...entities, fireCells: merged }, { currentFire: true, observed: true });
    expect(lit.filter((c) => c.source === "replay-truth")).toHaveLength(1);
  });

  it("replay truth is unchanged when the recorded view has no current fire", () => {
    const truth = { timeMs: 90_000, burning: [3000], burned: [3001] };
    const observed = buildSceneEntities(base, scenarioMap, { phase: "replay" }).fireCells;
    const merged = mergeTruthCells(observed, truth, scenarioMap);
    expect(merged.filter((c) => c.unseen).map((c) => c.gridCellIndex)).toEqual([3000, 3001]);
    expect(merged.filter((c) => c.unseen).every((c) => c.source === "replay-truth")).toBe(true);
  });
});

describe("issue #114 - tile inspection names the source and the time", () => {
  const entities = buildSceneEntities(withFire, scenarioMap);
  const current = entities.currentFire!.cells[0]!;
  const belief = entities.fireCells.find((c) => c.gridCellIndex === 2825)!;

  it("current fire: source is the live feed, time is the feed's simTimeMs", () => {
    const inspection = inspectFireCell(current, withFire.simTimeMs as number);
    expect(inspection.source).toMatch(/current fire/i);
    expect(inspection.source).toMatch(/live coordinator feed/i);
    expect(inspection.timeHeading).toBe("Feed time");
    expect(inspection.time).toBe("1:30 incident time");
    expect(inspection.state).toBe(current.burnState);
  });

  it("observed belief: source says belief, time is the observation time and its staleness", () => {
    const inspection = inspectFireCell(belief, withFire.simTimeMs as number);
    expect(inspection.source).toMatch(/observed belief/i);
    expect(inspection.timeHeading).toBe("Last observed");
    expect(inspection.time).toMatch(/incident time/);
    expect(inspection.time).toMatch(/s ago/);
    expect(inspection.state).toContain(belief.stale ? "stale" : belief.burnState);
  });

  it("replay truth: says it is replay only and not observed", () => {
    const truth = mergeTruthCells([], { timeMs: 60_000, burning: [3000], burned: [] }, scenarioMap)[0]!;
    const inspection = inspectFireCell(truth, 60_000);
    expect(inspection.source).toMatch(/replay only/i);
    expect(inspection.source).toMatch(/not observed/i);
  });

  it("uses simulation time only: wall time never enters the readout", () => {
    const view: CoordinatorView = { ...withFire, wallElapsedMs: 987_654 as never };
    const cell = buildSceneEntities(view, scenarioMap).currentFire!.cells[0]!;
    const inspection = inspectFireCell(cell, view.simTimeMs as number);
    expect(JSON.stringify(inspection)).not.toContain("987");
    expect(inspection.time).toBe("1:30 incident time");
  });
});
