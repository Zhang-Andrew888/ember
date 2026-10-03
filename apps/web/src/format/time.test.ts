import { describe, it, expect } from "vitest";
import { formatIncidentClock, formatRemainingWallTime } from "./time.js";

describe("format/time - formatIncidentClock", () => {
  it("formats zero as 0:00", () => {
    expect(formatIncidentClock(0)).toBe("0:00");
  });

  it("formats 90_000 ms as 1:30", () => {
    expect(formatIncidentClock(90_000)).toBe("1:30");
  });

  it("pads seconds under 10", () => {
    expect(formatIncidentClock(65_000)).toBe("1:05");
  });
});

describe("format/time - formatRemainingWallTime", () => {
  it("shows the full five minutes at zero elapsed", () => {
    expect(formatRemainingWallTime(0)).toBe("5:00");
  });

  it("counts down from the five-minute wall limit", () => {
    expect(formatRemainingWallTime(18_000)).toBe("4:42");
  });

  it("never goes negative past the deadline", () => {
    expect(formatRemainingWallTime(10 * 60 * 1000)).toBe("0:00");
  });
});
