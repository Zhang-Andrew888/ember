import { describe, expect, it } from "vitest";
import { BAN_MS, COOLDOWN_MS, DOWN_MS, FAST_DOWN_MS, FAST_SAMPLES, initialAutoTier, percentile75, recordFrame, UP_MS, WINDOW } from "./autoTier.js";

function feed(state: ReturnType<typeof initialAutoTier>, ms: number, count: number, startAt: number, stepMs = 100) {
  let s = state;
  for (let i = 0; i < count; i++) s = recordFrame(s, ms, startAt + i * stepMs);
  return s;
}

describe("auto tier", () => {
  it("does nothing until a full window of samples exists", () => {
    const s = feed(initialAutoTier("high"), DOWN_MS + 10, WINDOW - 1, 0);
    expect(s.tier).toBe("high");
  });

  it("steps down when the window is over budget, one tier at a time", () => {
    const s = feed(initialAutoTier("high"), DOWN_MS + 20, WINDOW, 0);
    expect(s.tier).toBe("medium");
    const s2 = feed(s, DOWN_MS + 20, WINDOW, 5000);
    expect(s2.tier).toBe("low");
  });

  it("never goes below low", () => {
    expect(feed(initialAutoTier("low"), 500, WINDOW * 2, 0).tier).toBe("low");
  });

  it("steps up only after the cooldown, and not into a tier it just fled", () => {
    const down = feed(initialAutoTier("high"), DOWN_MS + 10, WINDOW, 1000); // high -> medium, high banned
    expect(down.tier).toBe("medium");
    const tooSoon = feed(down, UP_MS - 5, WINDOW, 1000 + 100);
    expect(tooSoon.tier).toBe("medium"); // cooldown
    const afterCooldown = feed(down, UP_MS - 5, WINDOW, 1000 + COOLDOWN_MS + 100);
    expect(afterCooldown.tier).toBe("medium"); // still banned from high
    const afterBan = feed(down, UP_MS - 5, WINDOW, 1000 + BAN_MS + 100);
    expect(afterBan.tier).toBe("high");
  });

  it("a few spikes do not trigger a downgrade (p75, not max)", () => {
    let s = initialAutoTier("high");
    for (let i = 0; i < WINDOW; i++) s = recordFrame(s, i % 8 === 0 ? 300 : 10, i * 100);
    expect(s.tier).toBe("high");
  });

  it("a very slow machine steps down after a few frames, not a full window", () => {
    const s = feed(initialAutoTier("high"), FAST_DOWN_MS + 50, FAST_SAMPLES, 0);
    expect(s.tier).toBe("medium");
  });

  it("the fast path needs consecutive slow frames: one slow frame among fast ones does nothing", () => {
    let s = initialAutoTier("high");
    for (const ms of [500, 10, 500, 500, 500]) s = recordFrame(s, ms, 0);
    expect(s.tier).toBe("high");
  });

  it("moderately slow frames (over budget but under the fast threshold) still wait for the full window", () => {
    expect(feed(initialAutoTier("high"), DOWN_MS + 10, FAST_SAMPLES, 0).tier).toBe("high");
  });

  it("percentile75 of nothing is 0", () => {
    expect(percentile75([])).toBe(0);
    expect(percentile75([1, 2, 3, 4])).toBe(4);
  });
});
