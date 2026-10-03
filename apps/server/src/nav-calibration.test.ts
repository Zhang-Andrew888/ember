import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_CONFIG, NAV_CALIBRATION_PRESETS, presetNavConfig } from "@ember/navigation";

describe("nav calibration harness", () => {
  it("exposes a small named preset grid for offline sweeps", () => {
    expect(NAV_CALIBRATION_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(NAV_CALIBRATION_PRESETS.some((p) => p.id === "default")).toBe(true);
    expect(presetNavConfig(NAV_CALIBRATION_PRESETS[0]!)).toEqual(DEFAULT_NAV_CONFIG);
  });
});
