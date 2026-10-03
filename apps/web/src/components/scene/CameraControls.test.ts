import { describe, expect, it } from "vitest";
import { fitZoom } from "./CameraControls.js";

describe("fitZoom", () => {
  it("is limited by the narrower dimension", () => {
    expect(fitZoom(1100, 730)).toBeCloseTo(Math.min(1100 / 1500, 730 / 1050));
    expect(fitZoom(684, 545)).toBeCloseTo(684 / 1500);
  });

  it("shrinks monotonically with the canvas", () => {
    expect(fitZoom(600, 500)).toBeLessThan(fitZoom(1100, 730));
  });
});
