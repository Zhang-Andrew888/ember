import { describe, it, expect } from "vitest";
import { TIME_COMPRESSION, formatElapsedWallTime, formatIncidentClock, formatRemainingWallTime } from "./time.js";

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

  it("compresses 25 simulated minutes into the five-minute wall limit (5x)", () => {
    expect(TIME_COMPRESSION).toBe(5);
  });

  it("formats elapsed real time from wallElapsedMs", () => {
    expect(formatElapsedWallTime(300_000)).toBe("5:00");
    expect(formatElapsedWallTime(61_000)).toBe("1:01");
  });
});
