import { describe, expect, it } from "vitest";
import { CELL_BURNING, CELL_NONBURNABLE, CELL_UNBURNED, FireField, type FireParams } from "./index.js";

const N = 64;
const calm: FireParams = { spreadMultiplier: 1, initialWindRad: 0, windShiftMs: Infinity, postShiftWindRad: 0 };
const flat = () => ({ fuel: new Float64Array(N * N).fill(1), height: new Float64Array(N * N) });
const at = (x: number, y: number): number => y * N + x;

/** Steps until `cell` ignites, or Infinity within the limit. */
function ignitionTime(field: FireField, cell: number, limitMs = 600_000): number {
  for (let t = 1000; t <= limitMs; t += 1000) {
    field.step(t, 1000, calm);
    if (field.state[cell] === CELL_BURNING) return t;
  }
  return Infinity;
}

describe("partial clearance", () => {
  it("slows spread into a partly cleared cell and stops it at full clearance", () => {
    const times = [0, 0.5, 0.9].map((fraction) => {
      const field = new FireField(flat(), new Set());
      field.ignite([at(10, 10)], 0);
      field.applyClearance(at(11, 10), fraction);
      return ignitionTime(field, at(11, 10));
    });
    expect(times[1]).toBeGreaterThan(times[0]!);
    // 90% cleared takes spread below what a cell can deliver before it burns out.
    expect(times[2]).toBe(Infinity);
  });

  it("turns a fully cleared cell into a firebreak and refuses burning or finished cells", () => {
    const field = new FireField(flat(), new Set());
    expect(field.applyClearance(at(5, 5), 0.6)).toBe("progress");
    expect(field.state[at(5, 5)]).toBe(CELL_UNBURNED);
    expect(field.applyClearance(at(5, 5), 0.6)).toBe("completed");
    expect(field.state[at(5, 5)]).toBe(CELL_NONBURNABLE);
    expect(field.applyClearance(at(5, 5), 0.5)).toBe("none");
    field.ignite([at(20, 20)], 0);
    expect(field.applyClearance(at(20, 20), 0.5)).toBe("none");
  });

  it("is copied by clone", () => {
    const field = new FireField(flat(), new Set());
    field.applyClearance(at(3, 3), 0.25);
    expect(field.clone().clearance[at(3, 3)]).toBe(0.25);
  });
});

describe("diagonal corner gaps", () => {
  // Fire at (10,10); with (11,10) and (10,11) unable to burn, (11,11) is one diagonal step away or a detour.
  function diagonalReach(corners: "cleared" | "nonburnable"): number {
    const corner = [at(11, 10), at(10, 11)];
    const blocked = new Set(corners === "nonburnable" ? corner : []);
    const cleared = new Set(corners === "cleared" ? corner : []);
    const field = new FireField(flat(), blocked, cleared);
    field.ignite([at(10, 10)], 0);
    return ignitionTime(field, at(11, 11));
  }

  it("blocks the diagonal step between two cleared corner cells, so fire must go round", () => {
    // Only nonburnable corners (refuge areas) leave the diagonal step open, as before clearance existed.
    expect(diagonalReach("cleared")).toBeGreaterThan(diagonalReach("nonburnable") + 60_000);
  });

  it("seals a diagonal line of cleared cells that only touch at corners", () => {
    const line = new Set<number>();
    for (let i = 0; i < N; i++) line.add(at(i, i));
    const field = new FireField(flat(), new Set(), line);
    field.ignite([at(40, 10)], 0);
    for (let t = 1000; t <= 1_500_000; t += 1000) field.step(t, 1000, calm);
    // Nothing on the far side of the diagonal (y > x) ever ignites.
    for (let y = 0; y < N; y++) for (let x = 0; x < y; x++) expect(Number.isFinite(field.ignitedAtMs[at(x, y)]!)).toBe(false);
  });
});
