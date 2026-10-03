import { describe, expect, it } from "vitest";
import { canonicalJson, hashText, hashValue } from "./index.js";

describe("knowledge/digest", () => {
  it("serializes objects with sorted keys and skips undefined values", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }], u: undefined })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });

  it("encodes non-finite numbers as strings so they cannot collide with null", () => {
    expect(canonicalJson(Infinity)).not.toBe(canonicalJson(null));
    expect(canonicalJson({ x: NaN })).toBe('{"x":"NaN"}');
  });

  it("gives equal hashes to equal values regardless of key order and different hashes otherwise", () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue({ a: 1, b: 2 })).not.toBe(hashValue({ a: 1, b: 3 }));
    expect(hashText("ember")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashText("ember")).toBe(hashText("ember"));
  });
});
