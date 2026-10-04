import { describe, expect, it } from "vitest";
import { replayStepDelayMs } from "./playback.js";

describe("replayStepDelayMs", () => {
  it("scales with sim delta and caps extremes", () => {
    expect(replayStepDelayMs(1000, false)).toBe(80);
    expect(replayStepDelayMs(24_000, false)).toBe(800);
    expect(replayStepDelayMs(24_000, true)).toBe(1500);
  });
});
