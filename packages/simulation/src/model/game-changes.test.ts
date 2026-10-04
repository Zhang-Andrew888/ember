import { describe, expect, it } from "vitest";
import {
  GAME_CHANGES,
  gameCollaborationBonus,
  gameHoseConeMinDot,
  gameHoseDangerRadiusM,
  gameHoseOnSceneRadiusM,
  gameHoseRadiusM,
  gameHoseStandoffTargetM,
} from "./game-changes.js";
import { SIM_DEFAULTS } from "./constants.js";

describe("game-changes hose radii", () => {
  it("orders danger, standoff, on-scene, and max spray reach", () => {
    expect(GAME_CHANGES.hoseDangerRadiusTiles).toBeLessThan(GAME_CHANGES.hoseStandoffTargetTiles);
    expect(GAME_CHANGES.hoseStandoffTargetTiles).toBeLessThanOrEqual(GAME_CHANGES.hoseOnSceneRadiusTiles);
    expect(GAME_CHANGES.hoseOnSceneRadiusTiles).toBeLessThanOrEqual(GAME_CHANGES.hoseSuppressRadiusTiles);
    expect(gameHoseDangerRadiusM()).toBe(GAME_CHANGES.hoseDangerRadiusTiles * SIM_DEFAULTS.cellMeters);
    expect(gameHoseStandoffTargetM()).toBe(GAME_CHANGES.hoseStandoffTargetTiles * SIM_DEFAULTS.cellMeters);
    expect(gameHoseOnSceneRadiusM()).toBeLessThanOrEqual(gameHoseRadiusM());
    expect(gameHoseConeMinDot()).toBeCloseTo(0, 10);
  });
});

describe("game-changes hose collaboration", () => {
  const east = { hx: 1, hy: 0 };

  it("rewards a line spraying from the same side more than crews flanking the cell", () => {
    const line = gameCollaborationBonus(east, { hx: Math.SQRT1_2, hy: Math.SQRT1_2 });
    const flank = gameCollaborationBonus(east, { hx: 0, hy: 1 });
    const opposite = gameCollaborationBonus(east, { hx: -1, hy: 0 });
    expect(line).toBe(GAME_CHANGES.lineCollaborationBonusPerCrew);
    expect(flank).toBe(GAME_CHANGES.collaborationBonusPerCrew);
    expect(opposite).toBe(GAME_CHANGES.collaborationBonusPerCrew);
    expect(line).toBeGreaterThan(flank);
  });

  it("treats an unknown hose heading as a flanking crew", () => {
    expect(gameCollaborationBonus(null, east)).toBe(GAME_CHANGES.collaborationBonusPerCrew);
  });

  it("joins lines from 40 tiles away", () => {
    expect(GAME_CHANGES.brigadeJoinRadiusTiles).toBe(40);
  });
});
