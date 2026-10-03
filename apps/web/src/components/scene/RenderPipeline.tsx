import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { HalfFloatType, Vector2, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { VignetteShader } from "./quality/vignette.js";
import { initialAutoTier, percentile75, recordFrame, type AutoTierState } from "./quality/autoTier.js";
import { qualityStore, type SceneParams } from "./quality/qualityStore.js";
import type { QualityConfig } from "./quality/tiers.js";

/** Every Nth frame is timed with a GPU finish() so asynchronous GPU cost is counted. */
const SYNC_EVERY = 4;

/**
 * Owns rendering (a priority-1 useFrame disables R3F's own render):
 * - bloom + vignette + MSAA through a half-float EffectComposer when the
 *   tier wants them, otherwise a plain render;
 * - bloom only catches HDR pixels above `bloomThreshold` (> 1), which is only
 *   the additive fire shaders, so it is "bloom on fire only" without a second pass;
 * - times each frame and feeds the automatic quality tier.
 * Effects are absent in reduced motion and on the low tier (see tiers.ts).
 */
export function RenderPipeline({
  config,
  params,
  autoEnabled,
}: {
  readonly config: QualityConfig;
  readonly params: SceneParams;
  readonly autoEnabled: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const useComposer = config.bloom || config.vignette;
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  const vignetteRef = useRef<ShaderPass | null>(null);

  const composer = useMemo(() => {
    if (!useComposer) return null;
    const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: config.antialias ? 4 : 0 });
    const c = new EffectComposer(gl, target);
    c.addPass(new RenderPass(scene, camera));
    bloomRef.current = null;
    vignetteRef.current = null;
    if (config.bloom) {
      const bloom = new UnrealBloomPass(new Vector2(width, height), 0.55, 0.45, 1.0);
      bloomRef.current = bloom;
      c.addPass(bloom);
    }
    c.addPass(new OutputPass());
    if (config.vignette) {
      const vignette = new ShaderPass(VignetteShader);
      vignetteRef.current = vignette;
      c.addPass(vignette);
    }
    return c;
    // Size changes are applied by the effect below, not by rebuilding.
  }, [gl, scene, camera, useComposer, config.bloom, config.vignette, config.antialias]);

  useEffect(() => {
    if (!composer) return;
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(width, height);
  }, [composer, gl, width, height]);
  useEffect(() => () => composer?.dispose(), [composer]);

  // Live-tweakable parameters (debug panel in dev; defaults in production).
  useEffect(() => {
    const bloom = bloomRef.current;
    if (bloom) {
      bloom.strength = params.bloomStrength;
      bloom.radius = params.bloomRadius;
      bloom.threshold = params.bloomThreshold;
    }
    const vignette = vignetteRef.current;
    if (vignette) vignette.uniforms.uStrength!.value = params.vignetteStrength;
  }, [composer, params]);

  const autoRef = useRef<AutoTierState>(initialAutoTier(qualityStore.getState().autoTier, performance.now()));
  const frameCount = useRef(0);

  useFrame(() => {
    frameCount.current++;
    const timed = frameCount.current % SYNC_EVERY === 0;
    const start = performance.now();
    if (composer) composer.render();
    else gl.render(scene, camera);
    if (timed) {
      gl.getContext().finish();
      const cost = performance.now() - start;
      if (autoEnabled) {
        autoRef.current = recordFrame(autoRef.current, cost, performance.now());
        qualityStore.setAutoTier(autoRef.current.tier, percentile75(autoRef.current.samples));
      } else {
        qualityStore.setAutoTier(qualityStore.getState().autoTier, cost);
      }
    }
  }, 1);

  return null;
}
