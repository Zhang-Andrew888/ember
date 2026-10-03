import { describe, expect, it } from "vitest";
import { stripPrivateFields } from "./stripPrivate.js";
import snapshot from "./synthetic-v1.snapshot.json";

describe("stripPrivateFields", () => {
  it("removes requiredWork at any depth, leaving other fields", () => {
    const result = stripPrivateFields({
      sites: [{ id: "s", value: 1, requiredWork: 300 }],
      nested: { deep: [{ requiredWork: 1, keep: true }] },
    });
    expect(result).toEqual({ sites: [{ id: "s", value: 1 }], nested: { deep: [{ keep: true }] } });
  });

  it("the committed local snapshot ships no requiredWork", () => {
    expect(JSON.stringify(snapshot)).not.toContain("requiredWork");
  });
});
