/** Subtle edge darkening, applied in display space (after OutputPass). */
export const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    uStrength: { value: 0.28 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      float v = smoothstep(0.38, 0.95, d);
      color.rgb *= 1.0 - v * uStrength;
      gl_FragColor = color;
    }
  `,
};
