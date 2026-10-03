import type { IUniform, Material } from "three";

/**
 * Screen-space hatching for stale markers: every other diagonal band of
 * pixels is discarded, so an old observation reads as "see-through striped"
 * regardless of hue or opacity. `uStaleHatch` = 0 leaves the material
 * untouched (fresh).
 */
export interface StaleHatchUniform {
  uStaleHatch: IUniform<number>;
}

export function applyStaleHatch(material: Material, uniform: StaleHatchUniform): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material) ?? (() => "");
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uStaleHatch = uniform.uStaleHatch;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uStaleHatch;")
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        if (uStaleHatch > 0.5 && mod(gl_FragCoord.x + gl_FragCoord.y, 7.0) < 2.2) discard;`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey()}|ember-stale-hatch`;
}
