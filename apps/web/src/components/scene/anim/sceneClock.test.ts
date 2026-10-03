import { describe, expect, it } from "vitest";
import { isPerfContinuous } from "./sceneClock.js";

describe("isPerfContinuous", () => {
  it("is on only for the dev server with the flag present", () => {
    expect(isPerfContinuous("?perfContinuous", true)).toBe(true);
    expect(isPerfContinuous("?a=1&perfContinuous=1", true)).toBe(true);
  });

  it("can never be on in a production build, even with the flag", () => {
    expect(isPerfContinuous("?perfContinuous", false)).toBe(false);
  });

  it("is off without the flag", () => {
    expect(isPerfContinuous("", true)).toBe(false);
    expect(isPerfContinuous("?scenario=model-states", true)).toBe(false);
  });
});
