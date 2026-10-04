import { describe, expect, it } from "vitest";
import { GAME_CHANGES } from "@ember/simulation/model";

describe("crew fire knowledge", () => {
  it("does not plan from briefing ignition when useBriefingFireCells is off", () => {
    expect(GAME_CHANGES.useBriefingFireCells).toBe(false);
  });
});
