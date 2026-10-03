import { describe, it, expect } from "vitest";
import { resolveLabelCollisions } from "./stackLabels.js";

describe("components/scene/stackLabels - resolveLabelCollisions", () => {
  it("leaves non-overlapping labels in place", () => {
    const result = resolveLabelCollisions([
      { id: "a", x: 0, y: 0, visible: true, width: 40, height: 20 },
      { id: "b", x: 500, y: 0, visible: true, width: 40, height: 20 },
    ]);
    expect(result).toEqual([
      { id: "a", x: 0, y: 0, visible: true },
      { id: "b", x: 500, y: 0, visible: true },
    ]);
  });

  it("pushes a later label straight up when it collides with an earlier one at the same point", () => {
    const result = resolveLabelCollisions([
      { id: "site", x: 100, y: 200, visible: true, width: 60, height: 20 },
      { id: "agent", x: 100, y: 200, visible: true, width: 40, height: 20 },
    ]);
    expect(result[0]).toEqual({ id: "site", x: 100, y: 200, visible: true });
    expect(result[1]!.id).toBe("agent");
    expect(result[1]!.x).toBe(100);
    expect(result[1]!.y).toBeLessThan(200 - 20);
  });

  it("stacks three colliding labels without any two overlapping", () => {
    const result = resolveLabelCollisions([
      { id: "one", x: 0, y: 0, visible: true, width: 50, height: 20 },
      { id: "two", x: 0, y: 0, visible: true, width: 50, height: 20 },
      { id: "three", x: 0, y: 0, visible: true, width: 50, height: 20 },
    ]);
    const ys = result.map((r) => r.y);
    expect(new Set(ys).size).toBe(3);
  });

  it("pushes a label above a reserved fixed UI box it would otherwise render under", () => {
    const result = resolveLabelCollisions(
      [{ id: "refuge", x: 50, y: 100, visible: true, width: 80, height: 20 }],
      3,
      [{ left: 0, right: 200, top: 0, bottom: 150 }],
    );
    expect(result[0]!.y).toBeLessThan(0);
  });

  it("leaves a label alone when it doesn't overlap any reserved box", () => {
    const result = resolveLabelCollisions(
      [{ id: "refuge", x: 500, y: 100, visible: true, width: 80, height: 20 }],
      3,
      [{ left: 0, right: 200, top: 0, bottom: 150 }],
    );
    expect(result[0]).toEqual({ id: "refuge", x: 500, y: 100, visible: true });
  });

  it("passes invisible labels through unchanged without affecting collision placement", () => {
    const result = resolveLabelCollisions([
      { id: "hidden", x: 0, y: 0, visible: false, width: 50, height: 20 },
      { id: "visible", x: 0, y: 0, visible: true, width: 50, height: 20 },
    ]);
    expect(result[0]).toEqual({ id: "hidden", x: 0, y: 0, visible: false });
    expect(result[1]).toEqual({ id: "visible", x: 0, y: 0, visible: true });
  });
});
