import { describe, expect, it } from "vitest";
import { createTerrain } from "./terrain.js";
import { FireField, CELL_BURNED, CELL_BURNING } from "./fire.js";
import { SIM_DEFAULTS } from "./constants.js";

describe("game-changes fire suppression", () => {
  it("extinguishCell removes a cell from the burning list and marks it burned", () => {
    const terrain = createTerrain("t1");
    const fire = new FireField(terrain, new Set());
    fire.ignite([100], 0);
    expect(fire.burningCount).toBe(1);
    fire.extinguishCell(100);
    expect(fire.burningCount).toBe(0);
    expect(fire.state[100]).toBe(CELL_BURNED);
    expect(fire.spreadFactorFrom(100)).toBe(1);
  });

  it("completed containment work can extinguish instead of only slowing spread", () => {
    const terrain = createTerrain("t1");
    const fire = new FireField(terrain, new Set());
    fire.ignite([50], 0);
    const required = SIM_DEFAULTS.containmentWorkRequired;
    fire.applyContainmentWork(50, required);
    expect(fire.state[50]).toBe(CELL_BURNING);
    fire.extinguishCell(50);
    expect(fire.state[50]).toBe(CELL_BURNED);
    expect(fire.burningCells).not.toContain(50);
  });
});
