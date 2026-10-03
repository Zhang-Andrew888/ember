import { describe, expect, it } from "vitest";
import { buildEmberParticles, buildFlameInstances } from "./flameInstances.js";
import type { FireCellMarker } from "../sceneEntities.js";

function cell(index: number, burnState: FireCellMarker["burnState"], stale = false): FireCellMarker {
  return { key: `c${index}`, gridCellIndex: index, position: { x: index, z: -index }, burnState, stale, lastObservedAt: 0, ageMs: stale ? 90_000 : 0 };
}

describe("buildFlameInstances", () => {
  it("draws flames only for observed burning cells (never burned or unburned)", () => {
    const flames = buildFlameInstances([cell(1, "burning"), cell(2, "burned"), cell(3, "unburned")], 2, 22);
    expect(flames).toHaveLength(2);
    expect(flames.every((f) => Math.abs(f.x - 1) < 6)).toBe(true);
  });

  it("draws nothing at all with no observations", () => {
    expect(buildFlameInstances([], 3, 22)).toEqual([]);
  });

  it("stale fire is a dimmer ghost, flagged stale, never full intensity", () => {
    const [fresh] = buildFlameInstances([cell(1, "burning")], 1, 22);
    const [stale] = buildFlameInstances([cell(1, "burning", true)], 1, 22);
    expect(fresh?.intensity).toBe(1);
    expect(stale?.stale).toBe(true);
    expect(stale!.intensity).toBeLessThan(fresh!.intensity);
  });

  it("an older stale ghost is dimmer than a recently-stale one", () => {
    const recent = { ...cell(1, "burning", true), ageMs: 40_000 };
    const old = { ...cell(1, "burning", true), ageMs: 140_000 };
    const [a] = buildFlameInstances([recent], 1, 22);
    const [b] = buildFlameInstances([old], 1, 22);
    expect(b!.intensity).toBeLessThan(a!.intensity);
    expect(b!.intensity).toBeGreaterThan(0);
  });

  it("card count follows the tier and stays inside the cell", () => {
    const one = buildFlameInstances([cell(5, "burning")], 1, 22);
    const three = buildFlameInstances([cell(5, "burning")], 3, 22);
    expect(one).toHaveLength(1);
    expect(three).toHaveLength(3);
    for (const f of three) expect(Math.hypot(f.x - 5, f.z + 5)).toBeLessThan(22 / 2);
  });

  it("is deterministic", () => {
    const cells = [cell(7, "burning"), cell(9, "burning", true)];
    expect(buildFlameInstances(cells, 3, 22)).toEqual(buildFlameInstances(cells, 3, 22));
  });
});

describe("buildEmberParticles", () => {
  it("rises only from fresh burning cells", () => {
    const embers = buildEmberParticles([cell(1, "burning"), cell(2, "burning", true), cell(3, "burned")], 4);
    expect(embers).toHaveLength(4);
    expect(embers.every((e) => e.x === 1)).toBe(true);
  });
});
