import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, type IUniform, type MeshLambertMaterial, type MeshStandardMaterial } from "three";
import { SCENE_SIZE } from "../../../map/worldScale.js";
import { sceneClock } from "../anim/sceneClock.js";

/**
 * Shared uniforms for ground light and char. `uFireMap` is a gridSize x
 * gridSize texture (see fireMap.ts); materials sample it by world x/z.
 */
export const fireLightUniforms: { uFireMap: IUniform<DataTexture | null>; uFireGain: IUniform<number> } = {
  uFireMap: { value: null },
  uFireGain: { value: 1 },
};

export function ensureFireTexture(gridSize: number): DataTexture {
  const existing = fireLightUniforms.uFireMap.value;
  if (existing && existing.image.width === gridSize) return existing;
  const texture = new DataTexture(new Uint8Array(gridSize * gridSize * 4), gridSize, gridSize, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  fireLightUniforms.uFireMap.value = texture;
  return texture;
}

const GLOW_COLOR = "vec3(1.0, 0.42, 0.14)";
const CHAR_COLOR = "vec3(0.05, 0.04, 0.035)";

/**
 * Patches a MeshStandardMaterial so observed fire lights the surface
 * (emissive warm pool) and chars it. `instanced` reads the world position
 * through instanceMatrix. Chains any onBeforeCompile already set (tree sway).
 */
export function applyFireLight(material: MeshStandardMaterial | MeshLambertMaterial, instanced: boolean, charGround: boolean): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material) ?? (() => "");
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uFireMap = fireLightUniforms.uFireMap;
    shader.uniforms.uFireGain = fireLightUniforms.uFireGain;
    shader.uniforms.uTime = shader.uniforms.uTime ?? sceneClock.uTime;
    const worldXZ = instanced ? "(instanceMatrix * vec4(position, 1.0)).xz" : "position.xz";
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFirePos;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvFirePos = ${worldXZ};`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vFirePos;\nuniform sampler2D uFireMap;\nuniform float uFireGain;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec4 fireTexel = texture2D(uFireMap, (vFirePos + ${(SCENE_SIZE / 2).toFixed(1)}) / ${SCENE_SIZE.toFixed(1)});
        ${charGround ? `diffuseColor.rgb = mix(diffuseColor.rgb, ${CHAR_COLOR}, fireTexel.g * 0.85);` : `diffuseColor.rgb *= 1.0 - fireTexel.g * 0.0;`}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += ${GLOW_COLOR} * fireTexel.r * 0.3 * uFireGain;`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey()}|ember-fire-light-${instanced ? "i" : "s"}-${charGround ? "c" : "n"}`;
}
