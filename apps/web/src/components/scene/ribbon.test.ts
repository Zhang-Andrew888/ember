import { describe, expect, it } from "vitest";
import { buildRibbonData, subdividePolyline } from "./ribbon.js";

describe("buildRibbonData", () => {
  it("builds a quad for a straight segment, offset by half width on both sides", () => {
    const data = buildRibbonData([{ x: 0, z: 0 }, { x: 100, z: 0 }], 5, 7, 50);
    expect(data.positions).toHaveLength(12);
    // Normal of +x direction in XZ is (0, 1): vertices at z = +5 and z = -5.
    expect([data.positions[2], data.positions[5]]).toEqual([5, -5]);
    expect(data.positions[1]).toBe(7);
    expect(Array.from(data.indices)).toEqual([0, 2, 1, 1, 2, 3]);
  });

  it("tiles u by distance along the line", () => {
    const data = buildRibbonData([{ x: 0, z: 0 }, { x: 100, z: 0 }], 5, 0, 50);
    expect(data.uvs[0]).toBe(0);
    expect(data.uvs[4]).toBe(2);
  });

  it("returns empty buffers for fewer than two points", () => {
    expect(buildRibbonData([{ x: 1, z: 1 }], 5, 0, 10).indices).toHaveLength(0);
  });

  it("does not produce NaN for repeated points", () => {
    const data = buildRibbonData([{ x: 1, z: 1 }, { x: 1, z: 1 }], 5, 0, 10);
    expect(Array.from(data.positions).some(Number.isNaN)).toBe(false);
  });
});

describe("ribbon height and subdivision", () => {
  it("samples a height function per vertex", () => {
    const data = buildRibbonData([{ x: 0, z: 0 }, { x: 100, z: 0 }], 1, (x) => x / 10, 10);
    expect(data.positions[1]).toBe(0);
    expect(data.positions[7]).toBe(10);
  });

  it("subdivides long segments and keeps endpoints", () => {
    const out = subdividePolyline([{ x: 0, z: 0 }, { x: 100, z: 0 }], 30);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ x: 0, z: 0 });
    expect(out[4]).toEqual({ x: 100, z: 0 });
  });

  it("does not add points to short segments", () => {
    expect(subdividePolyline([{ x: 0, z: 0 }, { x: 5, z: 0 }], 30)).toHaveLength(2);
  });
});
