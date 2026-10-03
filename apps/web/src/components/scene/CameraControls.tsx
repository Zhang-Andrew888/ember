import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const FOCUS_TRANSITION_MS = 250;

interface FocusAnimation {
  readonly fromTarget: Vector3;
  readonly toTarget: Vector3;
  readonly fromPosition: Vector3;
  readonly toPosition: Vector3;
  readonly start: number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface CameraControlsHandle {
  reset(): void;
  /** Re-centers the orbit target on a ground point, preserving current zoom/tilt. */
  focusOn(x: number, z: number): void;
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
  const { camera, gl, invalidate } = useThree();
  const animationRef = useRef<FocusAnimation | null>(null);

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

  useEffect(() => {
    // Not `() => controls.dispose` - that returns the method unbound, so
    // React later calls it as a bare function with `this` undefined and
    // OrbitControls.dispose() (`this.disconnect()`) throws. Only
    // surfaced now that a component actually unmounts a <CameraControls>
    // (ReplayView <-> live), which never happened before this session.
    return () => controls.dispose();
  }, [controls]);

  // Canvas uses frameloop="demand" (SceneCanvas.tsx) - nothing renders
  // unless something actually changed. Pointer-driven orbiting already
  // invalidates through this; damping settling after a drag needs it too.
  useEffect(() => {
    const handleChange = () => invalidate();
    controls.addEventListener("change", handleChange);
    return () => controls.removeEventListener("change", handleChange);
  }, [controls, invalidate]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        // Full-fidelity instant restore (position/target/zoom together);
        // not tweened - see focusOn for the animated-transition case.
        animationRef.current = null;
        controls.reset();
      },
      focusOn: (x, z) => {
        const deltaX = x - controls.target.x;
        const deltaZ = z - controls.target.z;
        const toTarget = new Vector3(x, 0, z);
        const toPosition = new Vector3(camera.position.x + deltaX, camera.position.y, camera.position.z + deltaZ);

        if (reducedMotion) {
          animationRef.current = null;
          controls.target.copy(toTarget);
          camera.position.copy(toPosition);
          controls.update();
          return;
        }

        // Animate transitions over 250ms (docs/FRONTEND.md).
        animationRef.current = {
          fromTarget: controls.target.clone(),
          toTarget,
          fromPosition: camera.position.clone(),
          toPosition,
          start: performance.now(),
        };
        invalidate(); // kick off the first frame of the tween under frameloop="demand"
      },
    }),
    [controls, camera, reducedMotion],
  );

  useFrame(() => {
    const animation = animationRef.current;
    if (animation) {
      const t = Math.min(1, (performance.now() - animation.start) / FOCUS_TRANSITION_MS);
      const eased = easeOutCubic(t);
      controls.target.lerpVectors(animation.fromTarget, animation.toTarget, eased);
      camera.position.lerpVectors(animation.fromPosition, animation.toPosition, eased);
      if (t >= 1) {
        animationRef.current = null;
      } else {
        invalidate(); // keep the tween running under frameloop="demand"
      }
    }
    controls.update();
  });

  return null;
});
