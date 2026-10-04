import { describe, expect, it } from "vitest";
import type { PublicPreview } from "./briefingInfo.js";
import { FULL_SCENE_BOUNDS, fitPreview, previewBounds } from "./previewFit.js";
import { SCENE_SIZE } from "../map/worldScale.js";

const emptyPreview: PublicPreview = {
  roads: [],
  sites: [],
  refuges: [],
  initialFireCells: [],
  gridSize: 64,
  worldMeters: 1600,
};

describe("previewBounds", () => {
  it("returns null when the preview draws nothing", () => {
    expect(previewBounds(emptyPreview)).toBeNull();
  });

  it("wraps roads, markers, and the full extent of fire cells", () => {
    const cellSize = SCENE_SIZE / 64;
    const bounds = previewBounds({
      ...emptyPreview,
      roads: [{ id: "r", points: [{ x: -100, z: 20 }, { x: 50, z: 80 }] }],
      sites: [{ name: "S", x: 200, z: -40 }],
      refuges: [{ name: "R", x: -30, z: 300 }],
      // Cell 0 is the top-left grid cell; its far corner must be included, not just its origin.
      initialFireCells: [0],
    });
    expect(bounds).toEqual({
      minX: -SCENE_SIZE / 2,
      maxX: 200,
      minZ: -SCENE_SIZE / 2,
      maxZ: 300,
    });
    expect(bounds!.minX + cellSize).toBeLessThan(bounds!.maxX);
  });
});

describe("fitPreview", () => {
  const viewport = { width: 640, height: 360, padX: 100, padY: 30 };

  it("scales uniformly so the limiting axis fills the padded area and the other is centred", () => {
    const frame = fitPreview({ minX: 0, maxX: 300, minZ: 0, maxZ: 300 }, viewport);
    // Inner area is 440 x 300; a square box is limited by height.
    expect(frame.scale).toBe(1);
    expect(frame.offsetY).toBe(30);
    expect(frame.offsetX).toBe(100 + (440 - 300) / 2);
  });

  it("maps the bounds corners onto the padded viewport edges", () => {
    const bounds = { minX: -700, maxX: 700, minZ: -200, maxZ: 200 };
    const frame = fitPreview(bounds, viewport);
    const left = frame.offsetX + bounds.minX * frame.scale;
    const right = frame.offsetX + bounds.maxX * frame.scale;
    const top = frame.offsetY + bounds.minZ * frame.scale;
    const bottom = frame.offsetY + bounds.maxZ * frame.scale;
    expect(left).toBeCloseTo(100);
    expect(right).toBeCloseTo(540);
    expect(top).toBeGreaterThanOrEqual(30);
    expect(bottom).toBeLessThanOrEqual(330);
    expect(bottom - top).toBeCloseTo((right - left) * (400 / 1400));
  });

  it("never divides by zero for degenerate bounds", () => {
    const frame = fitPreview({ minX: 5, maxX: 5, minZ: 5, maxZ: 5 }, viewport);
    expect(Number.isFinite(frame.scale)).toBe(true);
    expect(Number.isFinite(frame.offsetX)).toBe(true);
  });

  it("falls back to the whole scene when nothing is drawn", () => {
    const frame = fitPreview(FULL_SCENE_BOUNDS, viewport);
    expect(frame.scale).toBeCloseTo(300 / SCENE_SIZE);
  });
});
