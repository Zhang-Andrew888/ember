import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface CameraControlsHandle {
  reset(): void;
}

export interface CameraControlsProps {
  readonly reducedMotion: boolean;
}

/**
 * Bounded orbit/pan/zoom for inspecting the scene (docs/FRONTEND.md:
 * "Allow modest orbit for inspection but constrain tilt so labels remain
 * legible"). Built on three's own OrbitControls (shipped inside the
 * "three" package) rather than adding @react-three/drei as a new
 * dependency for a single helper.
 */
export const CameraControls = forwardRef<CameraControlsHandle, CameraControlsProps>(function CameraControls(
  { reducedMotion },
  ref,
) {
  const { camera, gl } = useThree();

  const controls = useMemo(() => {
    const instance = new OrbitControls(camera, gl.domElement);
    instance.enableDamping = true;
    instance.dampingFactor = 0.12;
    instance.minPolarAngle = Math.PI / 6; // ~30 degrees: never flip to a flat top-down view
    instance.maxPolarAngle = Math.PI / 2.1; // keep labels legible, never go below horizon
    instance.minZoom = 0.6;
    instance.maxZoom = 3;
    instance.minDistance = 300;
    instance.maxDistance = 1400;
    instance.screenSpacePanning = false;
    return instance;
    // camera/gl are stable for the Canvas lifetime; this must only run once.
  }, []);

  useEffect(() => {
    controls.enableDamping = !reducedMotion;
  }, [controls, reducedMotion]);

  useEffect(() => controls.dispose, [controls]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => controls.reset(),
    }),
    [controls],
  );

  useFrame(() => {
    controls.update();
  });

  return null;
});
