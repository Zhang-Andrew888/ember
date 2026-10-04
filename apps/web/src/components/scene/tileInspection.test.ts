import { describe, expect, it } from "vitest";
import { fixtureCoordinatorView } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { fixtureCoordinatorViewWithCurrentFire } from "../../../../../tests/fixtures/coordinator-view-current-fire.fixture.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { buildSceneEntities } from "./sceneEntities.js";
import {
  coordinatorFireMarker,
  fireCellTarget,
  gridCellIndexFromRowColumn,
  inspectMapTile,
  isValidGridCellIndex,
  parseGridIndexInput,
  parseGridRowColumnInput,
} from "./tileInspection.js";

describe("tileInspection", () => {
  const withCurrentFire = buildSceneEntities(fixtureCoordinatorViewWithCurrentFire, scenarioMap);
  const observedOnly = buildSceneEntities(fixtureCoordinatorView, scenarioMap);

  it("validates in-bounds grid indices", () => {
    expect(isValidGridCellIndex(0)).toBe(true);
    expect(isValidGridCellIndex(4095)).toBe(true);
    expect(isValidGridCellIndex(4096)).toBe(false);
    expect(isValidGridCellIndex(-1)).toBe(false);
  });

  it("maps row and column to a grid index", () => {
    expect(gridCellIndexFromRowColumn(0, 0)).toBe(0);
    expect(gridCellIndexFromRowColumn(1, 0)).toBe(64);
    expect(gridCellIndexFromRowColumn(64, 0)).toBeNull();
  });

  it("uses current fire when the feed lists the cell", () => {
    const burning = withCurrentFire.currentFire!.cells.find((c) => c.burnState === "burning")!;
    const inspection = inspectMapTile({ kind: "terrain", gridCellIndex: burning.gridCellIndex }, withCurrentFire, 90_000);
    expect(inspection.source).toContain("Current fire");
    expect(inspection.state).toBe("burning");
  });

  it("reports unburned at feed time when current fire is present but the cell is not burning or burned", () => {
    const inspection = inspectMapTile({ kind: "terrain", gridCellIndex: 100 }, withCurrentFire, 90_000);
    expect(inspection.state).toBe("unburned");
    expect(inspection.time).toContain("incident time");
  });

  it("reports no fire data when there is no current-fire layer and no observation", () => {
    const inspection = inspectMapTile({ kind: "terrain", gridCellIndex: 100 }, observedOnly, 90_000);
    expect(inspection.state).toContain("No fire reported");
    expect(inspection.time).toBeNull();
  });

  it("returns the current-fire marker when the feed lists the cell", () => {
    const burned = withCurrentFire.currentFire!.cells.find((c) => c.burnState === "burned")!;
    const marker = coordinatorFireMarker(withCurrentFire, burned.gridCellIndex);
    expect(marker?.source).toBe("current-fire");
    expect(marker?.burnState).toBe("burned");
  });

  it("fire-cell targets match terrain lookup for the same index", () => {
    const cell = withCurrentFire.fireCells[0]!;
    const viaBed = inspectMapTile(fireCellTarget(cell), withCurrentFire, 90_000);
    const viaTerrain = inspectMapTile({ kind: "terrain", gridCellIndex: cell.gridCellIndex }, withCurrentFire, 90_000);
    expect(viaBed.gridCellIndex).toBe(viaTerrain.gridCellIndex);
    expect(viaBed.state).toBe(viaTerrain.state);
  });

  it("a fire-cell target shows the latest marker for the same cell and source after a snapshot update", () => {
    const cell = withCurrentFire.currentFire!.cells.find((c) => c.burnState === "burning")!;
    const target = fireCellTarget(cell);
    const updated = {
      fireCells: withCurrentFire.fireCells,
      currentFire: {
        ...withCurrentFire.currentFire!,
        cells: withCurrentFire.currentFire!.cells.map((c) =>
          c.gridCellIndex === cell.gridCellIndex ? { ...c, burnState: "burned" as const } : c,
        ),
      },
    };
    expect(inspectMapTile(target, withCurrentFire, 90_000).state).toBe("burning");
    expect(inspectMapTile(target, updated, 120_000).state).toBe("burned");
  });

  it("a fire-cell target falls back to coordinator terrain data when its marker disappears", () => {
    const cell = withCurrentFire.currentFire!.cells.find((c) => c.burnState === "burning")!;
    const target = fireCellTarget(cell);
    const cleared = {
      fireCells: [],
      currentFire: { ...withCurrentFire.currentFire!, cells: [] },
    };
    const inspection = inspectMapTile(target, cleared, 120_000);
    expect(inspection.gridCellIndex).toBe(cell.gridCellIndex);
    expect(inspection.state).toBe("unburned");
  });

  it("rejects blank grid input instead of inspecting cell 0", () => {
    expect(parseGridIndexInput("")).toMatchObject({ ok: false });
    expect(parseGridIndexInput("   ")).toMatchObject({ ok: false });
    expect(parseGridRowColumnInput("", "3")).toMatchObject({ ok: false });
    expect(parseGridRowColumnInput("3", "")).toMatchObject({ ok: false });
  });

  it("rejects non-whole and out-of-range grid input", () => {
    expect(parseGridIndexInput("1.5")).toMatchObject({ ok: false });
    expect(parseGridIndexInput("-1")).toMatchObject({ ok: false });
    expect(parseGridIndexInput("4096")).toMatchObject({ ok: false });
    expect(parseGridRowColumnInput("64", "0")).toMatchObject({ ok: false });
    expect(parseGridRowColumnInput("0", "abc")).toMatchObject({ ok: false });
  });

  it("accepts valid grid input, including an explicit 0", () => {
    expect(parseGridIndexInput("0")).toEqual({ ok: true, index: 0 });
    expect(parseGridIndexInput(" 4095 ")).toEqual({ ok: true, index: 4095 });
    expect(parseGridRowColumnInput("1", "2")).toEqual({ ok: true, index: 66 });
  });
});
