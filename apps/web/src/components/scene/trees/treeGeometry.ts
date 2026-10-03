import {
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  type BufferGeometry,
  type IUniform,
  type MeshLambertMaterial,
  type MeshStandardMaterial,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Part = { geometry: BufferGeometry; color: [number, number, number] };

function tint(geometry: BufferGeometry, color: [number, number, number]): BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set(color, i * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

function build(parts: Part[]): BufferGeometry {
  const merged = mergeGeometries(parts.map((p) => tint(p.geometry, p.color)));
  // mergeGeometries returns null if attributes mismatch - parts below are all indexed with the same attributes.
  if (!merged) throw new Error("tree geometry merge failed");
  return merged;
}

const TRUNK: [number, number, number] = [0.28, 0.2, 0.14];

/** Layered spruce: trunk + three cones, ~15 units tall at scale 1. */
export function createSpruceGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.7, 0.9, 3, 5);
  trunk.translate(0, 1.5, 0);
  const lower = new ConeGeometry(5, 7, 6);
  lower.translate(0, 6, 0);
  const mid = new ConeGeometry(3.8, 6, 6);
  mid.translate(0, 9.5, 0);
  const top = new ConeGeometry(2.4, 5, 6);
  top.translate(0, 12.5, 0);
  return build([
    { geometry: trunk, color: TRUNK },
    { geometry: lower, color: [0.16, 0.34, 0.22] },
    { geometry: mid, color: [0.2, 0.4, 0.25] },
    { geometry: top, color: [0.25, 0.46, 0.28] },
  ]);
}

/** Low-tier tree: stub trunk + one cone (~16 triangles instead of ~50). */
export function createSimpleTreeGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.8, 1, 3, 4);
  trunk.translate(0, 1.5, 0);
  const crown = new ConeGeometry(4.6, 13, 5);
  crown.translate(0, 9, 0);
  return build([
    { geometry: trunk, color: TRUNK },
    { geometry: crown, color: [0.2, 0.4, 0.25] },
  ]);
}

/** Pine: taller bare trunk with a narrow two-cone crown, ~16 units tall. */
export function createPineGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.6, 0.85, 7, 5);
  trunk.translate(0, 3.5, 0);
  const crown = new ConeGeometry(3.6, 7, 6);
  crown.translate(0, 10, 0);
  const tip = new ConeGeometry(2.2, 5, 6);
  tip.translate(0, 13.5, 0);
  return build([
    { geometry: trunk, color: TRUNK },
    { geometry: crown, color: [0.3, 0.45, 0.24] },
    { geometry: tip, color: [0.36, 0.52, 0.27] },
  ]);
}

export interface SwayUniforms {
  uTime: IUniform<number>;
  uSway: IUniform<number>;
}

/**
 * Wind sway in the vertex shader: displacement grows with height above the
 * trunk base and is phase-shifted per instance by its world position, so the
 * forest ripples instead of nodding in unison. uSway = 0 freezes it
 * (low tier, reduced motion) at zero per-frame cost.
 */
export function applySway(material: MeshStandardMaterial | MeshLambertMaterial, uniforms: SwayUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSway = uniforms.uSway;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uSway;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float swayAmount = position.y * 0.045 * uSway;
        float swayPhase = uTime * 1.4 + instanceMatrix[3].x * 0.035 + instanceMatrix[3].z * 0.028;
        transformed.x += sin(swayPhase) * swayAmount;
        transformed.z += cos(swayPhase * 0.8) * swayAmount * 0.6;`,
      );
  };
  material.customProgramCacheKey = () => "ember-tree-sway";
}
