/** Hand-written GLSL for the fire layers (no shader library dependency). */

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
`;

export const flameVertex = /* glsl */ `
attribute float aSeed;
attribute float aIntensity;
attribute float aStale;
uniform float uTime;
uniform float uMotion;
varying vec2 vUv;
varying float vSeed;
varying float vIntensity;
varying float vStale;
void main() {
  vUv = uv;
  vSeed = aSeed;
  vIntensity = aIntensity;
  vStale = aStale;
  vec3 p = position;
  // The tip leans a little in a slow breeze; frozen when uMotion is 0.
  p.x += sin(uTime * 0.9 * uMotion + aSeed * 6.2831) * 0.07 * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

export const flameFragment = /* glsl */ `
uniform float uTime;
uniform float uMotion;
varying vec2 vUv;
varying float vSeed;
varying float vIntensity;
varying float vStale;
${NOISE}
void main() {
  // Calm flicker: slow upward noise scroll, not a strobe.
  float t = uTime * uMotion * 0.45 + vSeed * 10.0;
  float n = fbm(vec2(vUv.x * 2.4 + vSeed * 7.0, vUv.y * 1.7 - t));
  float halfWidth = mix(0.5, 0.05, pow(vUv.y, 0.85)) * (0.72 + 0.55 * n);
  float d = abs(vUv.x - 0.5);
  float body = smoothstep(halfWidth, halfWidth * 0.3, d);
  float tip = smoothstep(1.0, 0.2, vUv.y + (n - 0.5) * 0.5);
  float flame = body * tip;

  float heat = clamp(1.0 - vUv.y * 1.1 + n * 0.3, 0.0, 1.0);
  vec3 cool = vec3(0.6, 0.1, 0.04);
  vec3 mid = vec3(1.25, 0.46, 0.12);
  vec3 hot = vec3(1.9, 1.35, 0.75);
  vec3 col = mix(cool, mid, smoothstep(0.0, 0.55, heat));
  col = mix(col, hot, smoothstep(0.55, 1.0, heat));

  if (vStale > 0.5) {
    // Old observation: static, desaturated and hatched - never reads as live flame.
    float stripe = step(0.5, fract((vUv.x + vUv.y) * 9.0));
    col = vec3(0.5, 0.58, 0.6);
    flame *= stripe * 0.8;
  }
  float a = flame * vIntensity;
  gl_FragColor = vec4(col * a, a);
}
`;

export const emberVertex = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uMotion;
uniform float uPx;
varying float vLife;
void main() {
  float life = fract(uTime * 0.22 * (0.6 + aSeed * 0.8) + aSeed * 13.0);
  vec3 p = position;
  p.y += 6.0 + life * 70.0;
  p.x += sin(life * 6.0 + aSeed * 20.0) * 7.0 + life * 14.0;
  p.z += cos(life * 5.0 + aSeed * 17.0) * 7.0;
  vLife = life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPx * (2.2 + aSeed * 2.2) * (1.0 - life * 0.6);
  gl_Position = projectionMatrix * mv;
}
`;

export const emberFragment = /* glsl */ `
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * (1.0 - vLife) * smoothstep(0.0, 0.08, vLife);
  gl_FragColor = vec4(vec3(1.7, 0.75, 0.28) * a, a);
}
`;

export const smokeVertex = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uMotion;
varying vec2 vUv;
varying float vLife;
void main() {
  vUv = uv;
  float life = fract(uTime * 0.06 * uMotion + aSeed);
  vLife = life;
  vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // Rise and billow in view space so the puff always faces the camera.
  float size = mix(26.0, 70.0, life);
  centre.y += life * 55.0;
  centre.xy += position.xy * size;
  gl_Position = projectionMatrix * centre;
}
`;

export const smokeFragment = /* glsl */ `
varying vec2 vUv;
varying float vLife;
${NOISE}
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float n = fbm(vUv * 3.0 + vLife * 2.0);
  float a = smoothstep(1.0, 0.2, d) * (0.5 + 0.7 * n) * smoothstep(0.0, 0.15, vLife) * (1.0 - vLife);
  // Faint on purpose: smoke must never hide routes or labels.
  gl_FragColor = vec4(vec3(0.16, 0.17, 0.19), a * 0.14);
}
`;
