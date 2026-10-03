import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { IUniform } from "three";

/**
 * One shared clock for every decorative animation (tree sway, flames,
 * embers, smoke, ground glow). The Canvas runs frameloop="demand", so the
 * clock is a capped timer that bumps `uTime` and requests a frame: the
 * render rate is set here, never by vsync, and costs nothing when
 * `animated` is false (low tier, reduced motion).
 */
export const sceneClock: { uTime: IUniform<number>; uMotion: IUniform<number> } = {
  uTime: { value: 0 },
  uMotion: { value: 1 },
};

export const CLOCK_INTERVAL_MS = 66;

/**
 * `?perfContinuous` (dev server only) renders every animation frame instead of
 * at the capped clock rate, so scripts/perf.mjs can measure the frame time the
 * scene could actually sustain. `import.meta.env.DEV` is false in production
 * builds, so the flag cannot exist there.
 */
export function isPerfContinuous(search: string, dev: boolean): boolean {
  return dev && new URLSearchParams(search).has("perfContinuous");
}

export function SceneClock({ animated }: { readonly animated: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    sceneClock.uMotion.value = animated ? 1 : 0;
    invalidate();
    if (!animated) return;
    if (isPerfContinuous(window.location.search, import.meta.env.DEV)) {
      let frame = 0;
      const loop = () => {
        sceneClock.uTime.value = performance.now() / 1000;
        invalidate();
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(frame);
    }
    const interval = setInterval(() => {
      sceneClock.uTime.value = performance.now() / 1000;
      invalidate();
    }, CLOCK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [animated, invalidate]);
  return null;
}
