import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_CONFIG } from "./types.js";
import { NAV_CALIBRATION_PRESETS, presetNavConfig } from "./calibration-grid.js";

describe("nav calibration presets", () => {
  it("keeps defaults for the baseline preset", () => {
    const base = NAV_CALIBRATION_PRESETS.find((p) => p.id === "default");
    expect(base).toBeDefined();
    expect(presetNavConfig(base!)).toEqual(DEFAULT_NAV_CONFIG);
  });

  it("merges buffer overrides without dropping other fields", () => {
    const tight = NAV_CALIBRATION_PRESETS.find((p) => p.id === "buffer-tight");
    expect(presetNavConfig(tight!).bufferMs).toBe(25_000);
    expect(presetNavConfig(tight!).speedMps).toBe(DEFAULT_NAV_CONFIG.speedMps);
  });
});
