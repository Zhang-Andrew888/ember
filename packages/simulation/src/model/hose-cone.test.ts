import { describe, expect, it } from "vitest";
import { gameHoseConeMinDot } from "./game-changes.js";
import { hoseCellInCone } from "./hose-cone.js";

describe("hoseCellInCone", () => {
  const minDot = gameHoseConeMinDot();

  it("hits cells ahead within range and ignores cells behind", () => {
    expect(hoseCellInCone(0, 0, 1, 0, 100, 0, 200, minDot)).toBe(true);
    expect(hoseCellInCone(0, 0, 1, 0, -100, 0, 200, minDot)).toBe(false);
  });

  it("respects max distance", () => {
    expect(hoseCellInCone(0, 0, 1, 0, 500, 0, 400, minDot)).toBe(false);
  });
});
