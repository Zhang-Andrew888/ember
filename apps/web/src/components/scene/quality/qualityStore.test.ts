import { afterEach, describe, expect, it } from "vitest";
import { currentTier, DEFAULT_PARAMS, qualityStore } from "./qualityStore.js";

afterEach(() => {
  qualityStore.setMode("auto");
  qualityStore.resetParams();
  qualityStore.setAutoTier("high", 0);
});

describe("qualityStore", () => {
  it("uses the auto tier unless a manual override is set", () => {
    qualityStore.setAutoTier("medium", 20);
    expect(currentTier(qualityStore.getState())).toBe("medium");
    qualityStore.setMode("low");
    expect(currentTier(qualityStore.getState())).toBe("low");
    qualityStore.setMode("auto");
    expect(currentTier(qualityStore.getState())).toBe("medium");
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    let calls = 0;
    const off = qualityStore.subscribe(() => calls++);
    qualityStore.setParams({ fogNear: 1 });
    off();
    qualityStore.setParams({ fogNear: 2 });
    expect(calls).toBe(1);
  });

  it("patches and resets params", () => {
    qualityStore.setParams({ bloomStrength: 2 });
    expect(qualityStore.getState().params.bloomStrength).toBe(2);
    qualityStore.resetParams();
    expect(qualityStore.getState().params).toBe(DEFAULT_PARAMS);
  });

  it("bloom threshold default keeps ordinary lit pixels out of the bloom", () => {
    expect(DEFAULT_PARAMS.bloomThreshold).toBeGreaterThanOrEqual(1);
  });

  it("ignores a no-op auto tier update (no needless re-render)", () => {
    qualityStore.setAutoTier("high", 10);
    let calls = 0;
    const off = qualityStore.subscribe(() => calls++);
    qualityStore.setAutoTier("high", 10.2);
    off();
    expect(calls).toBe(0);
  });
});
