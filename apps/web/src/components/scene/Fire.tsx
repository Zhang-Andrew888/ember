import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  type InstancedMesh,
  type Points,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { sceneClock } from "./anim/sceneClock.js";
import { buildEmberParticles, buildFlameInstances } from "./fire/flameInstances.js";
import { buildFireMap } from "./fire/fireMap.js";
import { ensureFireTexture, fireLightUniforms } from "./fire/fireLight.js";
import { emberFragment, emberVertex, flameFragment, flameVertex, smokeFragment, smokeVertex } from "./fire/shaders.js";
import { burnByCell } from "./trees/treePlacement.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { useQuality } from "./quality/QualityContext.js";
import type { FireCellMarker } from "./sceneEntities.js";

const EMBERS_PER_CELL = 5;

/** Two crossed upright quads, base at y = 0, so a flame reads from any orbit angle. */
function crossedCards(): BufferGeometry {
  const a = new PlaneGeometry(1, 1);
  a.translate(0, 0.5, 0);
  const b = new PlaneGeometry(1, 1);
  b.translate(0, 0.5, 0);
  b.rotateY(Math.PI / 2);
  const merged = mergeGeometries([a, b]);
  if (!merged) throw new Error("flame card merge failed");
  return merged;
}

/**
 * Observed fire as light, not geometry: shader flame cards, rising embers
 * and a faint smoke layer, plus the ground light/char map. Everything is
 * derived from observed cells only. Embers and smoke drop out on low tier
 * and in reduced motion; flame cards stay (held steady) because they are
 * how live fire is distinguished from a stale ghost.
 */
export function Fire({ cells, reducedMotion }: { readonly cells: readonly FireCellMarker[]; readonly reducedMotion: boolean }) {
  const quality = useQuality();
  return (
    <>
      <GroundLight cells={cells} />
      <Flames cells={cells} cards={quality.flameCards} />
      {quality.embers && !reducedMotion ? <Embers cells={cells} /> : null}
      {quality.smoke && !reducedMotion ? <Smoke cells={cells} /> : null}
    </>
  );
}

function GroundLight({ cells }: { readonly cells: readonly FireCellMarker[] }) {
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const texture = ensureFireTexture(sceneTerrain.gridSize);
    const data = buildFireMap(sceneTerrain.gridSize, burnByCell(cells));
    (texture.image.data as Uint8Array).set(data);
    texture.needsUpdate = true;
    invalidate();
  }, [cells, invalidate]);
  return null;
}

function Flames({ cells, cards }: { readonly cells: readonly FireCellMarker[]; readonly cards: number }) {
  const meshRef = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const flames = useMemo(() => buildFlameInstances(cells, cards, sceneTerrain.cellSize), [cells, cards]);
  const geometry = useMemo(crossedCards, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: flameVertex,
        fragmentShader: flameFragment,
        uniforms: { uTime: sceneClock.uTime, uMotion: sceneClock.uMotion },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const dummy = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const seed = new Float32Array(flames.length);
    const intensity = new Float32Array(flames.length);
    const stale = new Float32Array(flames.length);
    flames.forEach((flame, i) => {
      dummy.position.set(flame.x, sceneTerrain.groundY(flame.x, flame.z) + 1, flame.z);
      dummy.scale.set(flame.width, flame.height, flame.width);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      seed[i] = flame.seed;
      intensity[i] = flame.intensity;
      stale[i] = flame.stale ? 1 : 0;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute("aSeed", new InstancedBufferAttribute(seed, 1));
    mesh.geometry.setAttribute("aIntensity", new InstancedBufferAttribute(intensity, 1));
    mesh.geometry.setAttribute("aStale", new InstancedBufferAttribute(stale, 1));
    invalidate();
  }, [flames, dummy, invalidate]);

  if (flames.length === 0) return null;
  return (
    <instancedMesh
      key={flames.length}
      ref={meshRef}
      args={[geometry, material, flames.length]}
      frustumCulled={false}
      renderOrder={6}
    />
  );
}

function Embers({ cells }: { readonly cells: readonly FireCellMarker[] }) {
  const ref = useRef<Points>(null);
  const dpr = useThree((state) => state.viewport.dpr);
  const particles = useMemo(() => buildEmberParticles(cells, EMBERS_PER_CELL), [cells]);
  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    const positions = new Float32Array(particles.length * 3);
    const seeds = new Float32Array(particles.length);
    particles.forEach((p, i) => {
      positions.set([p.x, sceneTerrain.groundY(p.x, p.z), p.z], i * 3);
      seeds[i] = p.seed;
    });
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
    return geo;
  }, [particles]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: emberVertex,
        fragmentShader: emberFragment,
        uniforms: { uTime: sceneClock.uTime, uMotion: sceneClock.uMotion, uPx: { value: dpr } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [dpr],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  if (particles.length === 0) return null;
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={7} />;
}

function Smoke({ cells }: { readonly cells: readonly FireCellMarker[] }) {
  const puffs = useMemo(() => {
    const out: { x: number; z: number; seed: number }[] = [];
    for (const cell of cells) {
      if (cell.burnState !== "burning" || cell.stale) continue;
      for (let i = 0; i < 2; i++) out.push({ x: cell.position.x, z: cell.position.z, seed: (cell.gridCellIndex * 0.37 + i * 0.5) % 1 });
    }
    return out;
  }, [cells]);
  const meshRef = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: smokeVertex,
        fragmentShader: smokeFragment,
        uniforms: { uTime: sceneClock.uTime, uMotion: sceneClock.uMotion },
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const dummy = useMemo(() => new Object3D(), []);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const seeds = new Float32Array(puffs.length);
    puffs.forEach((puff, i) => {
      dummy.position.set(puff.x, sceneTerrain.groundY(puff.x, puff.z) + 8, puff.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      seeds[i] = puff.seed;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
  }, [puffs, dummy]);
  if (puffs.length === 0) return null;
  return <instancedMesh key={puffs.length} ref={meshRef} args={[geometry, material, puffs.length]} frustumCulled={false} renderOrder={4} />;
}

export { fireLightUniforms };
