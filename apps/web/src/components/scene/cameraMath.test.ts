import { describe, expect, it } from "vitest";
import {
  easeOutCubic,
  FOLLOW_EPSILON,
  FOLLOW_TAU_SECONDS,
  followStep,
  isPanGesture,
  lerp,
  RESET_DURATION_MS,
  tweenProgress,
} from "./cameraMath.js";

describe("followStep", () => {
  const from = { x: 0, z: 0 };
  const to = { x: 100, z: -50 };

  it("moves toward the target without overshooting", () => {
    const { next, arrived } = followStep(from, to, 1 / 60, false);
    expect(arrived).toBe(false);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
    expect(next.z).toBeLessThan(0);
    expect(next.z).toBeGreaterThan(-50);
  });

  it("is frame-rate independent: two half steps equal one full step", () => {
    const one = followStep(from, to, 0.1, false).next;
    const half = followStep(followStep(from, to, 0.05, false).next, to, 0.05, false).next;
    expect(half.x).toBeCloseTo(one.x, 6);
    expect(half.z).toBeCloseTo(one.z, 6);
  });

  it("covers ~95% of the distance in about 250 ms", () => {
    const { next } = followStep(from, to, 3 * FOLLOW_TAU_SECONDS, false);
    expect(next.x / 100).toBeGreaterThan(0.94);
  });

  it("a huge frame gap lands on the target, not past it", () => {
    const { next } = followStep(from, to, 60, false);
    expect(next.x).toBeCloseTo(100, 3);
    expect(next.x).toBeLessThanOrEqual(100);
  });

  it("reduced motion snaps straight to the target", () => {
    expect(followStep(from, to, 1 / 60, true)).toEqual({ next: to, arrived: true });
  });

  it("stops (arrived) once within epsilon, so no frames are requested forever", () => {
    const near = { x: 100 - FOLLOW_EPSILON / 2, z: -50 };
    expect(followStep(near, to, 1 / 60, false).arrived).toBe(true);
  });

  it("a zero or negative dt does not move", () => {
    expect(followStep(from, to, 0, false).next).toEqual(from);
    expect(followStep(from, to, -1, false).next).toEqual(from);
  });
});

describe("tween helpers", () => {
  it("progress is clamped and a zero duration completes immediately", () => {
    expect(tweenProgress(1000, 1000 + RESET_DURATION_MS / 2, RESET_DURATION_MS)).toBeCloseTo(0.5);
    expect(tweenProgress(1000, 0, RESET_DURATION_MS)).toBe(0);
    expect(tweenProgress(1000, 99999, RESET_DURATION_MS)).toBe(1);
    expect(tweenProgress(0, 5, 0)).toBe(1);
  });

  it("easeOutCubic is monotone from 0 to 1 and clamps", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(3)).toBe(1);
  });

  it("lerp interpolates", () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });
});

describe("isPanGesture", () => {
  const base = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false };
  it("plain left-drag (orbit) does not pause follow; right/middle/modifier drags do", () => {
    expect(isPanGesture(base)).toBe(false);
    expect(isPanGesture({ ...base, button: 2 })).toBe(true);
    expect(isPanGesture({ ...base, button: 1 })).toBe(true);
    expect(isPanGesture({ ...base, shiftKey: true })).toBe(true);
    expect(isPanGesture({ ...base, ctrlKey: true })).toBe(true);
    expect(isPanGesture({ ...base, metaKey: true })).toBe(true);
  });
});
