import { describe, expect, it } from "vitest";
import { buildFireMap } from "./fireMap.js";
import type { CellBurn } from "../trees/treePlacement.js";

const N = 8;
const at = (data: Uint8Array, x: number, y: number, channel: 0 | 1) => data[(y * N + x) * 4 + channel]!;

describe("buildFireMap", () => {
  it("is completely dark with no observations (unknown ground stays dark)", () => {
    const data = buildFireMap(N, new Map());
    for (let i = 0; i < N * N; i++) {
      expect(data[i * 4]).toBe(0);
      expect(data[i * 4 + 1]).toBe(0);
    }
  });

  it("lights a burning cell fully and its neighbours less, with nothing far away", () => {
    const data = buildFireMap(N, new Map<number, CellBurn>([[3 * N + 3, "burning"]]));
    expect(at(data, 3, 3, 0)).toBe(255);
    expect(at(data, 4, 3, 0)).toBeLessThan(at(data, 3, 3, 0));
    expect(at(data, 4, 3, 0)).toBeGreaterThan(at(data, 5, 3, 0));
    expect(at(data, 7, 7, 0)).toBe(0);
  });

  it("a stale burning report lights the ground far less than a fresh one", () => {
    const fresh = buildFireMap(N, new Map<number, CellBurn>([[27, "burning"]]));
    const stale = buildFireMap(N, new Map<number, CellBurn>([[27, "burning-stale"]]));
    expect(at(stale, 3, 3, 0)).toBeLessThan(at(fresh, 3, 3, 0) / 2);
  });

  it("burned ground is charred but gives no light", () => {
    const data = buildFireMap(N, new Map<number, CellBurn>([[27, "burned"]]));
    expect(at(data, 3, 3, 1)).toBe(255);
    expect(at(data, 3, 3, 0)).toBe(0);
  });

  it("overlapping light saturates instead of overflowing", () => {
    const burns = new Map<number, CellBurn>([[27, "burning"], [28, "burning"], [35, "burning"], [36, "burning"]]);
    const data = buildFireMap(N, burns);
    expect(at(data, 4, 4, 0)).toBe(255);
  });

  it("ignores out-of-range cell indices", () => {
    expect(() => buildFireMap(N, new Map<number, CellBurn>([[9999, "burning"]]))).not.toThrow();
  });
});
