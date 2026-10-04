import { describe, expect, it } from "vitest";
import { fixtureCoordinatorView } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { fixtureCoordinatorViewWithCurrentFire } from "../../../../../tests/fixtures/coordinator-view-current-fire.fixture.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { buildSceneEntities } from "./sceneEntities.js";
import {
  coordinatorFireMarker,
  gridCellIndexFromRowColumn,
  inspectMapTile,
  isValidGridCellIndex,
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
    const viaBed = inspectMapTile({ kind: "fire-cell", cell }, withCurrentFire, 90_000);
    const viaTerrain = inspectMapTile({ kind: "terrain", gridCellIndex: cell.gridCellIndex }, withCurrentFire, 90_000);
    expect(viaBed.gridCellIndex).toBe(viaTerrain.gridCellIndex);
    expect(viaBed.state).toBe(viaTerrain.state);
  });
});
