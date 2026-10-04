import { describe, expect, it } from "vitest";
import { IntentEnvelope } from "./intent.js";

const base = { commandId: "c", inputSequence: 0, kind: "objective", evidenceQueries: [], unsupportedClaims: [] } as const;
const parse = (objective: unknown) => IntentEnvelope.safeParse({ ...base, objective });

describe("line objective contract", () => {
  it("parses a line between two places", () => {
    expect(parse({ kind: "line", anchor: { placeName: "Waterworks" }, course: { kind: "to_place", placeName: "Ridge Cabins" } }).success).toBe(true);
  });

  it("parses an offset anchor with a heading course", () => {
    const result = parse({
      kind: "line",
      anchor: { placeName: "East Junction", offsetMeters: 200, offsetDirection: "west" },
      course: { kind: "heading", direction: "north", lengthMeters: 500 },
    });
    expect(result.success).toBe(true);
  });

  it("parses a bearing course, a heading to the edge, and a heading with no length", () => {
    const anchor = { placeName: "Waterworks" };
    expect(parse({ kind: "line", anchor, course: { kind: "heading", bearingDeg: 30, lengthMeters: 400 } }).success).toBe(true);
    expect(parse({ kind: "line", anchor, course: { kind: "heading", direction: "north", toEdge: true } }).success).toBe(true);
    expect(parse({ kind: "line", anchor, course: { kind: "heading", direction: "south" } }).success).toBe(true);
  });

  it("parses every kind of crew end", () => {
    const anchor = { placeName: "Waterworks" };
    const course = { kind: "to_place", placeName: "Ridge Cabins" };
    const ends = ["start", "far", { compass: "south" }, { placeName: "Ridge Cabins" }];
    for (const end of ends) {
      expect(parse({ kind: "line", anchor, course, crews: [{ recipient: "Crew 1", end }] }).success).toBe(true);
    }
    expect(parse({ kind: "line", anchor, course, crews: [{ recipient: "Crew 1", end: "middle" }] }).success).toBe(false);
  });

  it("no longer accepts the node-to-node wording", () => {
    const old = parse({ kind: "line", fromName: "Waterworks", toName: "Ridge Cabins", assignments: [{ recipient: "Crew 1", startName: "Waterworks" }] });
    expect(old.success && old.data.objective).toEqual({ kind: "line" });
  });

  it("rejects an unknown course kind or a non-positive length", () => {
    const anchor = { placeName: "Waterworks" };
    expect(parse({ kind: "line", anchor, course: { kind: "spiral" } }).success).toBe(false);
    expect(parse({ kind: "line", anchor, course: { kind: "heading", direction: "north", lengthMeters: 0 } }).success).toBe(false);
  });
});
