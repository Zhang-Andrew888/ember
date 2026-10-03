/** Pure camera helpers (no three.js), so follow/reset behaviour is unit-tested. */

/** Time constant of the follow easing: ~95% of the way in 3 * tau = 240 ms (docs/FRONTEND.md: 250 ms transitions). */
export const FOLLOW_TAU_SECONDS = 0.08;
export const RESET_DURATION_MS = 250;
/** Below this distance (scene units) follow is considered arrived and stops requesting frames. */
export const FOLLOW_EPSILON = 0.4;

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

/**
 * Next camera-target position when following. Exponential smoothing that is
 * frame-rate independent and cannot overshoot; `snap` (reduced motion) jumps.
 */
export function followStep(current: Point2, target: Point2, dtSeconds: number, snap: boolean): { next: Point2; arrived: boolean } {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  if (snap || Math.hypot(dx, dz) <= FOLLOW_EPSILON) {
    return { next: { x: target.x, z: target.z }, arrived: true };
  }
  const alpha = 1 - Math.exp(-Math.max(0, dtSeconds) / FOLLOW_TAU_SECONDS);
  return { next: { x: current.x + dx * alpha, z: current.z + dz * alpha }, arrived: false };
}

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/** Progress 0..1 of a timed tween. */
export function tweenProgress(startMs: number, nowMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - startMs) / durationMs));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface PointerGesture {
  readonly button: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly pointerType: string;
  /** Touch pointers currently down, including this one. */
  readonly touchCount: number;
}

/**
 * Only a PAN gesture pauses follow, and "pan" is exactly what three's
 * OrbitControls treats as pan: right button, left button with a modifier, or
 * two fingers (which also pinch-zoom). The middle button is DOLLY (zoom), and
 * one finger is ROTATE, so neither pauses follow: a user can orbit and zoom
 * to inspect the crew they are following without losing it.
 */
export function isPanGesture(gesture: PointerGesture): boolean {
  if (gesture.pointerType === "touch") return gesture.touchCount >= 2;
  if (gesture.button === 2) return true;
  return gesture.button === 0 && (gesture.shiftKey || gesture.ctrlKey || gesture.metaKey);
}
