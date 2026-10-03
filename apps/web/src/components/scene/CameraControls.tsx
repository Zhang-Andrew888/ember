import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  easeOutCubic,
  followStep,
  isPanGesture,
  lerp,
  RESET_DURATION_MS,
  tweenProgress,
  type Point2,
} from "./cameraMath.js";

interface ResetTween {
  readonly fromTarget: Vector3;
  readonly toTarget: Vector3;
  readonly fromPosition: Vector3;
  readonly toPosition: Vector3;
  readonly fromZoom: number;
  readonly toZoom: number;
  readonly start: number;
}

/** Orthographic zoom that fits the ~1400-unit scene (plus label margin) in a canvas of this size. */
export function fitZoom(widthPx: number, heightPx: number): number {
  const SCENE_FIT_WIDTH = 1500;
  // The ~50 degree tilt foreshortens depth, so the vertical budget is smaller than the width's.
  const SCENE_FIT_HEIGHT = 1050;
  return Math.min(widthPx / SCENE_FIT_WIDTH, heightPx / SCENE_FIT_HEIGHT);
}

export interface CameraControlsHandle {
  /** Returns to the fitted pose: a 250 ms ease, or instant in reduced motion. */
  reset(): void;
}

export interface CameraControlsProps {
  readonly reducedMotion: boolean;
  /** Ground point to keep centred; null = not following. */
  readonly followTarget: Point2 | null;
  /** The user started panning: follow should pause so the camera never fights them. */
  readonly onUserPan: () => void;
}

/**
 * Bounded orbit/pan/zoom for inspecting the scene (docs/FRONTEND.md:
 * "Allow modest orbit for inspection but constrain tilt so labels remain
 * legible"), built on three's own OrbitControls rather than adding
 * @react-three/drei as a dependency for one helper. Adds:
 * - follow: ease the orbit target toward `followTarget` (snap in reduced motion);
 * - an animated reset to the fitted pose (instant in reduced motion).
 */
export const CameraControls = forwardRef<CameraControlsHandle, CameraControlsProps>(function CameraControls(
  { reducedMotion, followTarget, onUserPan },
  ref,
) {
  const { camera, gl, invalidate } = useThree();
  const resetRef = useRef<ResetTween | null>(null);
  const followRef = useRef<Point2 | null>(followTarget);
  followRef.current = followTarget;
  const onUserPanRef = useRef(onUserPan);
  onUserPanRef.current = onUserPan;

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

  // Fit the whole scene into the canvas once, then remember that pose as
  // the reset target (OrbitControls.reset restores the saved state).
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const fitted = useRef(false);
  const fittedPose = useRef<{ target: Vector3; position: Vector3; zoom: number } | null>(null);
  useEffect(() => {
    if (fitted.current || width === 0 || height === 0) return;
    fitted.current = true;
    if ("zoom" in camera) {
      const zoom = fitZoom(width, height);
      camera.zoom = zoom;
      // Allow zooming out a little past the fit, but never so far the scene is lost.
      controls.minZoom = zoom * 0.85;
      camera.updateProjectionMatrix();
    }
    fittedPose.current = {
      target: controls.target.clone(),
      position: camera.position.clone(),
      zoom: "zoom" in camera ? (camera.zoom as number) : 1,
    };
    controls.saveState();
    invalidate();
  }, [camera, controls, invalidate, width, height]);

  useEffect(() => {
    controls.enableDamping = !reducedMotion;
  }, [controls, reducedMotion]);

  useEffect(() => {
    // Not `() => controls.dispose` - that returns the method unbound, so
    // React later calls it as a bare function with `this` undefined and
    // OrbitControls.dispose() (`this.disconnect()`) throws.
    return () => controls.dispose();
  }, [controls]);

  // Canvas uses frameloop="demand" - nothing renders unless something
  // changed. Pointer-driven orbiting already invalidates through this;
  // damping settling after a drag needs it too.
  useEffect(() => {
    const handleChange = () => invalidate();
    controls.addEventListener("change", handleChange);
    return () => controls.removeEventListener("change", handleChange);
  }, [controls, invalidate]);

  // A pan gesture hands the camera back to the user.
  useEffect(() => {
    const element = gl.domElement;
    const touches = new Set<number>();
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") touches.add(event.pointerId);
      const gesture = {
        button: event.button,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        pointerType: event.pointerType,
        touchCount: touches.size,
      };
      if (isPanGesture(gesture)) onUserPanRef.current();
    };
    const handlePointerEnd = (event: PointerEvent) => touches.delete(event.pointerId);
    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointerup", handlePointerEnd);
    element.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("pointerup", handlePointerEnd);
      element.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [gl]);

  // Start (or stop) following: kick the first frame under frameloop="demand".
  useEffect(() => {
    if (followTarget) invalidate();
  }, [followTarget, invalidate]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        const pose = fittedPose.current;
        if (!pose) {
          controls.reset();
          return;
        }
        const zoom = "zoom" in camera ? (camera.zoom as number) : 1;
        if (reducedMotion) {
          resetRef.current = null;
          controls.target.copy(pose.target);
          camera.position.copy(pose.position);
          if ("zoom" in camera) {
            camera.zoom = pose.zoom;
            camera.updateProjectionMatrix();
          }
          controls.update();
          invalidate();
          return;
        }
        resetRef.current = {
          fromTarget: controls.target.clone(),
          toTarget: pose.target.clone(),
          fromPosition: camera.position.clone(),
          toPosition: pose.position.clone(),
          fromZoom: zoom,
          toZoom: pose.zoom,
          start: performance.now(),
        };
        invalidate(); // kick off the first frame of the tween
      },
    }),
    [controls, camera, reducedMotion, invalidate],
  );

  useFrame((_, delta) => {
    const tween = resetRef.current;
    if (tween) {
      const t = easeOutCubic(tweenProgress(tween.start, performance.now(), RESET_DURATION_MS));
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, t);
      camera.position.lerpVectors(tween.fromPosition, tween.toPosition, t);
      if ("zoom" in camera) {
        camera.zoom = lerp(tween.fromZoom, tween.toZoom, t);
        camera.updateProjectionMatrix();
      }
      if (tweenProgress(tween.start, performance.now(), RESET_DURATION_MS) >= 1) resetRef.current = null;
      else invalidate();
    } else if (followRef.current) {
      const { next, arrived } = followStep({ x: controls.target.x, z: controls.target.z }, followRef.current, delta, reducedMotion);
      const dx = next.x - controls.target.x;
      const dz = next.z - controls.target.z;
      controls.target.x += dx;
      controls.target.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
      // Keep rendering until we arrive; once there, a moving target re-invalidates via the clock/new snapshots.
      if (!arrived) invalidate();
    }
    controls.update();
  });

  return null;
});
