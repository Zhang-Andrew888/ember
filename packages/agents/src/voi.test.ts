import { describe, expect, it } from "vitest";
import { binaryEntropyBits, closureProbability, scoreObservationPoint, type VoiMember } from "./voi.js";

const member = (closesAt: number): VoiMember => ({ ignitionMs: [Infinity, closesAt, Infinity] });
const edge = { id: "e1", cells: [1] };
const imp = (v: number) => new Map([["e1", v]]);
const score = (members: VoiMember[], over: Partial<Parameters<typeof scoreObservationPoint>[0]> = {}) =>
  scoreObservationPoint({ members, edges: [edge], importance: imp(2), closedCells: new Set(), relevantMs: 100, ...over });

describe("value of information", () => {
  it("binary entropy is 0 at certainty, 1 bit at an even split, symmetric and bounded", () => {
    expect(binaryEntropyBits(0)).toBe(0);
    expect(binaryEntropyBits(1)).toBe(0);
    expect(binaryEntropyBits(0.5)).toBeCloseTo(1, 12);
    expect(binaryEntropyBits(0.2)).toBeCloseTo(binaryEntropyBits(0.8), 12);
    for (let p = 0; p <= 1; p += 0.05) {
      expect(binaryEntropyBits(p)).toBeGreaterThanOrEqual(0);
      expect(binaryEntropyBits(p)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("closure probability counts the members in which a cell has ignited by the time", () => {
    expect(closureProbability([member(50), member(150), member(Infinity)], [1], 100)).toBeCloseTo(1 / 3, 12);
    expect(closureProbability([], [1], 100)).toBe(0);
  });

  it("is zero when members agree, either way", () => {
    expect(score([member(50), member(50)]).total).toBe(0);
    expect(score([member(500), member(500)]).total).toBe(0);
  });

  it("is largest at an even split and rises as the split evens out", () => {
    const at = (closed: number, of: number) => score([...Array(closed).fill(member(50)), ...Array(of - closed).fill(member(500))]).total;
    expect(at(2, 4)).toBeGreaterThan(at(1, 4));
    expect(at(1, 4)).toBeGreaterThan(at(0, 4));
    expect(at(2, 4)).toBeCloseTo(2, 12); // 1 bit times importance 2
  });

  it("scales with public importance and is zero for an unimportant corridor", () => {
    const m = [member(50), member(500)];
    expect(score(m, { importance: imp(4) }).total).toBeCloseTo(2 * score(m, { importance: imp(2) }).total, 12);
    expect(score(m, { importance: imp(0) }).total).toBe(0);
    expect(score(m, { importance: new Map() }).total).toBe(0);
  });

  it("is zero for a corridor the scout already saw closed", () => {
    const s = score([member(50), member(500)], { closedCells: new Set([1]) });
    expect(s.total).toBe(0);
    expect(s.edges[0]).toMatchObject({ known: true, closureProbability: 1, infoBits: 0 });
  });

  it("sums over corridors and breaks the score down per corridor", () => {
    const s = scoreObservationPoint({
      members: [{ ignitionMs: [50, 500] }, { ignitionMs: [500, 500] }],
      edges: [{ id: "a", cells: [0] }, { id: "b", cells: [1] }],
      importance: new Map([["a", 1], ["b", 3]]),
      closedCells: new Set(),
      relevantMs: 100,
    });
    expect(s.edges.map((e) => e.edgeId)).toEqual(["a", "b"]);
    expect(s.total).toBeCloseTo(1, 12); // only a is split
  });

  it("is deterministic", () => {
    const m = [member(50), member(500), member(70)];
    expect(score(m)).toEqual(score(m));
  });
});
