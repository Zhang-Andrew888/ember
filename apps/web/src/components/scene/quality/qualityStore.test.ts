import { afterEach, describe, expect, it } from "vitest";
import { currentTier, DEFAULT_PARAMS, frameMsStore, qualityStore } from "./qualityStore.js";

afterEach(() => {
  qualityStore.setMode("auto");
  qualityStore.resetParams();
  qualityStore.setAutoTier("high");
  frameMsStore.set(0);
});

describe("qualityStore", () => {
  it("uses the auto tier unless a manual override is set", () => {
    qualityStore.setAutoTier("medium");
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
    qualityStore.setAutoTier("high");
    let calls = 0;
    const off = qualityStore.subscribe(() => calls++);
    qualityStore.setAutoTier("high");
    off();
    expect(calls).toBe(0);
  });

  it("frame timing never touches the main store, so Canvas subscribers are not re-rendered by it", () => {
    let mainCalls = 0;
    let frameCalls = 0;
    const offMain = qualityStore.subscribe(() => mainCalls++);
    const offFrame = frameMsStore.subscribe(() => frameCalls++);
    frameMsStore.set(12);
    frameMsStore.set(12.2); // within 0.5 ms: ignored
    frameMsStore.set(30);
    offMain();
    offFrame();
    expect(mainCalls).toBe(0);
    expect(frameCalls).toBe(2);
  });
});
