import { describe, expect, it } from "vitest";
import { SIM_DEFAULTS } from "./constants.js";
import { DEFAULT_LINE_LENGTH_M, anchorPoint, compassBearing, firelineCells, firelineId, lineEnd } from "./firelines.js";

describe("fire line helpers", () => {
  it("measures bearings clockwise from north, with world north as +y", () => {
    expect(compassBearing("north")).toBe(0);
    expect(compassBearing("east")).toBe(90);
    expect(compassBearing("south")).toBe(180);
    expect(compassBearing("west")).toBe(270);
    expect(compassBearing("northeast")).toBe(45);
    const north = lineEnd({ x: 800, y: 800 }, compassBearing("north"), 100).end;
    expect(north).toEqual({ x: 800, y: 900 });
    const east = lineEnd({ x: 800, y: 800 }, compassBearing("east"), 100).end;
    expect(east).toEqual({ x: 900, y: 800 });
  });

  it("uses a 200 m line unless told otherwise, and keeps reach at 400 m", () => {
    expect(DEFAULT_LINE_LENGTH_M).toBe(200);
    expect(SIM_DEFAULTS.lineReachM).toBe(400);
    expect(lineEnd({ x: 800, y: 800 }, 0, DEFAULT_LINE_LENGTH_M)).toEqual({ end: { x: 800, y: 1000 }, clampedToEdge: false });
  });

  it("shortens a line at the map edge and says so", () => {
    expect(lineEnd({ x: 800, y: 1500 }, 0, 500)).toEqual({ end: { x: 800, y: 1600 }, clampedToEdge: true });
    expect(lineEnd({ x: 100, y: 800 }, 270, 500)).toEqual({ end: { x: 0, y: 800 }, clampedToEdge: true });
    // A diagonal stops at whichever edge it meets first.
    const diagonal = lineEnd({ x: 1500, y: 800 }, 45, 500);
    expect(diagonal.clampedToEdge).toBe(true);
    expect(diagonal.end.x).toBeCloseTo(1600, 6);
  });

  it("runs 'to the edge' exactly to the edge without calling it shortened", () => {
    expect(lineEnd({ x: 800, y: 600 }, 0, "edge")).toEqual({ end: { x: 800, y: 1600 }, clampedToEdge: false });
  });

  it("returns an anchor offset toward a direction, or null when it falls off the map", () => {
    expect(anchorPoint({ x: 800, y: 600 }, 200, "west")).toEqual({ x: 600, y: 600 });
    expect(anchorPoint({ x: 800, y: 600 }, 0, "north")).toEqual({ x: 800, y: 600 });
    expect(anchorPoint({ x: 100, y: 600 }, 200, "west")).toBeNull();
    expect(anchorPoint({ x: 800, y: 1500 }, 200, "north")).toBeNull();
  });

  it("gives one id for both directions, ordered by end cell", () => {
    const a = { x: 100, y: 800 };
    const b = { x: 400, y: 800 };
    expect(firelineId(a, b)).toBe(firelineId(b, a));
    expect(firelineId(a, b)).toBe(`line:${32 * 64 + 4}~${32 * 64 + 16}`);
    expect(firelineId(a, b)).not.toBe(firelineId(a, { x: 400, y: 825 }));
  });

  it("lists cells start to end, the same cells in reverse for the other direction", () => {
    const a = { x: 100, y: 800 };
    const b = { x: 400, y: 1000 };
    const cells = firelineCells(a, b);
    expect(cells[0]).toBe(32 * 64 + 4);
    expect(cells[cells.length - 1]).toBe(40 * 64 + 16);
    expect(firelineCells(b, a)).toEqual([...cells].reverse());
  });

  it("reaches the far map edge, and has no cells for a point off the map", () => {
    expect(firelineCells({ x: 800, y: 1500 }, { x: 800, y: 1600 }).at(-1)).toBe(63 * 64 + 32);
    expect(firelineCells({ x: 800, y: 1500 }, { x: 800, y: 1700 })).toEqual([]);
  });
});
