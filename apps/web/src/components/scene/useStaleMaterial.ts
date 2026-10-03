import { useEffect, useLayoutEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type { MeshStandardMaterial } from "three";
import { applyStaleHatch, type StaleHatchUniform } from "./staleHatch.js";
import type { Freshness } from "./staleness.js";

/**
 * A marker material whose colour, opacity and hatching follow how fresh the
 * information is. Updates happen in a layout effect and request a frame
 * explicitly: the Canvas is frameloop="demand", and in reduced motion no
 * clock is running, so a mutation made during render would not repaint until
 * something unrelated asked for a frame (a stale marker would keep looking
 * current).
 * `factory` is called once per component instance.
 */
export function useStaleMaterial(
  factory: () => MeshStandardMaterial,
  color: string,
  fresh: Freshness,
  hatched: boolean,
): MeshStandardMaterial {
  const invalidate = useThree((state) => state.invalidate);
  const uniform = useMemo<StaleHatchUniform>(() => ({ uStaleHatch: { value: 0 } }), []);
  const material = useMemo(() => {
    const created = factory();
    applyStaleHatch(created, uniform);
    return created;
  }, [uniform]);

  useLayoutEffect(() => {
    material.color.set(color);
    material.transparent = fresh.stale;
    material.opacity = fresh.opacity;
    uniform.uStaleHatch.value = hatched ? 1 : 0;
    invalidate();
  }, [material, uniform, color, fresh.stale, fresh.opacity, hatched, invalidate]);

  useEffect(() => () => material.dispose(), [material]);
  return material;
}
