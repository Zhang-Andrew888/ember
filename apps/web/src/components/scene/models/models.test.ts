import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { createChevronGeometry, createCrewGeometry, createCrossGeometry, createScoutGeometry, createWarnGeometry, createWorkGlyphGeometry } from "./crewModels.js";
import { createFenceRingGeometry, createRubbleGeometry, createSiteGeometry } from "./siteModels.js";
import { prism } from "./geometry.js";

function size(geometry: BufferGeometry) {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox!;
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z, minY: b.min.y };
}

function finite(geometry: BufferGeometry): boolean {
  return !Array.from(geometry.getAttribute("position").array).some(Number.isNaN);
}

describe("crew and scout models", () => {
  it("a crew truck is long, low, sits on the ground and has a colour attribute", () => {
    const truck = createCrewGeometry(1);
    const s = size(truck);
    expect(s.x).toBeGreaterThan(30);
    expect(s.x).toBeGreaterThan(s.z);
    expect(s.minY).toBeGreaterThan(-0.001);
    expect(truck.getAttribute("color")).toBeDefined();
    expect(finite(truck)).toBe(true);
  });

  it("more crew number means more tally pegs, so a different silhouette", () => {
    const counts = [1, 2, 3].map((n) => createCrewGeometry(n).getAttribute("position").count);
    expect(counts[1]).toBeGreaterThan(counts[0]!);
    expect(counts[2]).toBeGreaterThan(counts[1]!);
  });

  it("the scout is a different outline from any crew: tall and narrow in x, binocular-wide in z", () => {
    const scout = size(createScoutGeometry());
    const truck = size(createCrewGeometry(1));
    expect(scout.x).toBeLessThan(truck.x);
    expect(scout.y).toBeGreaterThan(truck.y);
  });

  it("all glyphs build finite geometry", () => {
    for (const g of [createChevronGeometry(), createWarnGeometry(), createCrossGeometry(), createWorkGlyphGeometry()]) {
      expect(finite(g)).toBe(true);
      expect(g.getAttribute("position").count).toBeGreaterThan(0);
    }
  });
});

describe("site models", () => {
  it("the three site silhouettes differ in size and complexity", () => {
    const shapes = (["cabins", "waterworks", "lodge"] as const).map((kind) => {
      const g = createSiteGeometry(kind);
      return { count: g.getAttribute("position").count, ...size(g) };
    });
    expect(new Set(shapes.map((s) => s.count)).size).toBe(3);
    expect(new Set(shapes.map((s) => `${Math.round(s.x)}x${Math.round(s.y)}`)).size).toBe(3);
    for (const s of shapes) expect(s.minY).toBeGreaterThanOrEqual(-0.001);
  });

  it("the lodge is long, the waterworks tall", () => {
    const lodge = size(createSiteGeometry("lodge"));
    const water = size(createSiteGeometry("waterworks"));
    expect(lodge.x).toBeGreaterThan(lodge.z);
    expect(water.y).toBeGreaterThan(lodge.y);
  });

  it("rubble is much lower than any intact site", () => {
    const rubble = size(createRubbleGeometry());
    for (const kind of ["cabins", "waterworks", "lodge"] as const) {
      expect(rubble.y).toBeLessThan(size(createSiteGeometry(kind)).y / 2);
    }
  });

  it("the fence ring leaves a gap (protection underway, not complete)", () => {
    const posts = 11;
    const perPost = createFenceRingGeometry(34, 2).getAttribute("position").count; // 1 post
    expect(createFenceRingGeometry(34, 12).getAttribute("position").count).toBe(perPost * posts);
  });

  it("prism has a ridge above its base", () => {
    expect(size(prism(10, 6, 4)).y).toBe(4);
  });
});
