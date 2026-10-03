import { describe, expect, it } from "vitest";
import { limitingReasonDisplayText } from "./limitingReason.js";

describe("format/limitingReason", () => {
  it("maps known planner codes to coordinator copy", () => {
    expect(limitingReasonDisplayText("work_interval_limited_by_forecast")).toBe(
      "work window limited by forecast",
    );
  });

  it("falls back to spaced words for unknown codes", () => {
    expect(limitingReasonDisplayText("single-capacity_hold")).toBe("single capacity hold");
  });

  it("does not treat inherited object keys as mapped codes", () => {
    expect(limitingReasonDisplayText("toString")).toBe("toString");
    expect(limitingReasonDisplayText("constructor")).toBe("constructor");
  });
});
