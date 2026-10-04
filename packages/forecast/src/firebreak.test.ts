import { describe, expect, it } from "vitest";
import { buildSyntheticScenario, firebreakPresetCells, withFirebreaks } from "@ember/simulation";
import { rolloutContext } from "./index.js";

describe("forecast rollouts and firebreaks", () => {
  it("treat map firebreaks as nonburnable, with their own cached context", () => {
    const base = buildSyntheticScenario();
    const cells = firebreakPresetCells(base, "head-line");
    const plain = rolloutContext(base.map);
    const broken = rolloutContext(withFirebreaks(base, cells).map);
    expect(broken.key).not.toBe(plain.key);
    for (const cell of cells) {
      expect(broken.nonburnable.has(cell)).toBe(true);
      expect(plain.nonburnable.has(cell)).toBe(false);
    }
  });
});
