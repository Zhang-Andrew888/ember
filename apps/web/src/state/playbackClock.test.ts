import { describe, expect, it } from "vitest";
import { playbackWallElapsedMs } from "./playbackClock.js";

describe("playbackWallElapsedMs", () => {
  const first = { wallElapsedMs: 1_000, atMs: 10_000 };

  it("advances in real time between recorded frames", () => {
    expect(playbackWallElapsedMs(1_000, first, 40_000)).toBe(31_000);
  });

  it("is never earlier than the latest frame", () => {
    expect(playbackWallElapsedMs(90_000, first, 20_000)).toBe(90_000);
  });

  it("never runs past five minutes", () => {
    expect(playbackWallElapsedMs(1_000, first, 10_000_000)).toBe(300_000);
  });

  it("does not run backwards when the clock reads earlier than the first frame", () => {
    expect(playbackWallElapsedMs(1_000, first, 5_000)).toBe(1_000);
  });
});
