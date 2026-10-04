import { describe, expect, it } from "vitest";
import { buildSyntheticScenario, SIM_DEFAULTS } from "./index.js";
import { FireField, RoadIndex, createTerrain, refugeCells } from "./model/index.js";
import { derivePrivateParameters } from "./world.js";

describe("fire containment (#116)", () => {
  it("fully restrained burning cells spread to fewer neighbors under the same params", () => {
    const scenario = buildSyntheticScenario();
    const terrain = createTerrain(scenario.map.terrainSeed);
    const road = new RoadIndex(scenario.map);
    const nonburn = refugeCells(road, SIM_DEFAULTS.refugeRadiusM);
    const fireOpen = new FireField(terrain, nonburn);
    const fireHeld = new FireField(terrain, nonburn);
    const seedCell = scenario.map.initialFireCells[0]!;
    fireOpen.ignite([seedCell], 0);
    fireHeld.ignite([seedCell], 0);
    fireHeld.applyContainmentWork(seedCell, SIM_DEFAULTS.containmentWorkRequired);
    const params = derivePrivateParameters("contain-ab", { spreadMultiplier: 1.4, windShiftMs: 9_999_999 });
    let openIgnitions = fireOpen.ignitionCount();
    let heldIgnitions = fireHeld.ignitionCount();
    for (let step = 0; step < 120; step++) {
      const t = (step + 1) * 1000;
      openIgnitions += fireOpen.step(t, 1000, params).length;
      heldIgnitions += fireHeld.step(t, 1000, params).length;
    }
    expect(heldIgnitions).toBeLessThan(openIgnitions);
  });

  it("partial containment work scales spread before completion", () => {
    const scenario = buildSyntheticScenario();
    const terrain = createTerrain(scenario.map.terrainSeed);
    const road = new RoadIndex(scenario.map);
    const nonburn = refugeCells(road, SIM_DEFAULTS.refugeRadiusM);
    const partial = new FireField(terrain, nonburn);
    const seedCell = scenario.map.initialFireCells[0]!;
    partial.ignite([seedCell], 0);
    partial.applyContainmentWork(seedCell, SIM_DEFAULTS.containmentWorkRequired / 2);
    expect(partial.spreadFactorFrom(seedCell)).toBeGreaterThan(0);
    expect(partial.spreadFactorFrom(seedCell)).toBeLessThan(1);
  });
});
