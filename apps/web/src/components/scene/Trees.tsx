import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Color, MeshStandardMaterial, Object3D, type BufferGeometry, type InstancedMesh } from "three";
import { sceneTerrain, waterCells, roadSamplePoints } from "./terrain/sceneTerrain.js";
import { createProximityTest } from "./trees/roadMask.js";
import { burnByCell, placeTrees, treeBrightness, type CellBurn, type TreeInstance } from "./trees/treePlacement.js";
import { applySway, createPineGeometry, createSpruceGeometry, type SwayUniforms } from "./trees/treeGeometry.js";
import { useQuality } from "./quality/QualityContext.js";
import type { FireCellMarker } from "./sceneEntities.js";

/** Wide enough to keep the forecast ribbon (up to 16 units each side of the road) and route clear of canopies. */
const ROAD_CLEARANCE = 26;
const SWAY_INTERVAL_MS = 80;

/**
 * Instanced conifers: two species, one draw call each. Density follows the
 * vegetation layer and the quality tier; trees in cells with observed fire
 * char and darken (colour is decoration here: fire status is also carried
 * by the flame cards and the inspection list).
 */
export function Trees({ fireCells, reducedMotion }: { readonly fireCells: readonly FireCellMarker[]; readonly reducedMotion: boolean }) {
  const quality = useQuality();
  const invalidate = useThree((state) => state.invalidate);

  const blocked = useMemo(() => createProximityTest(roadSamplePoints(), ROAD_CLEARANCE), []);
  const trees = useMemo(
    () => placeTrees({ field: sceneTerrain, blocked, waterCells: new Set(waterCells), densityFactor: quality.treeDensity }),
    [blocked, quality.treeDensity],
  );
  const bySpecies = useMemo(
    () => [trees.filter((t) => t.species === 0), trees.filter((t) => t.species === 1)] as const,
    [trees],
  );
  const burns = useMemo(() => burnByCell(fireCells), [fireCells]);

  const uniforms = useMemo<SwayUniforms>(() => ({ uTime: { value: 0 }, uSway: { value: 0 } }), []);
  const swaying = quality.sway && !reducedMotion;
  useEffect(() => {
    uniforms.uSway.value = swaying ? 1 : 0;
    invalidate();
  }, [swaying, uniforms, invalidate]);
  // Under frameloop="demand" a timer (not useFrame) drives the sway so the
  // render rate is capped independently of vsync (same approach as FireCells).
  useEffect(() => {
    if (!swaying) return;
    const interval = setInterval(() => {
      uniforms.uTime.value = performance.now() / 1000;
      invalidate();
    }, SWAY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [swaying, uniforms, invalidate]);

  return (
    <>
      <TreeSpecies trees={bySpecies[0]} burns={burns} geometryFactory={createSpruceGeometry} uniforms={uniforms} />
      <TreeSpecies trees={bySpecies[1]} burns={burns} geometryFactory={createPineGeometry} uniforms={uniforms} />
    </>
  );
}

function TreeSpecies({
  trees,
  burns,
  geometryFactory,
  uniforms,
}: {
  readonly trees: readonly TreeInstance[];
  readonly burns: ReadonlyMap<number, CellBurn>;
  readonly geometryFactory: () => BufferGeometry;
  readonly uniforms: SwayUniforms;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(geometryFactory, [geometryFactory]);
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    applySway(m, uniforms);
    return m;
  }, [uniforms]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const dummy = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);

  // Placement (matrices) only changes with the tree set.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    trees.forEach((tree, i) => {
      dummy.position.set(tree.x, tree.y, tree.z);
      dummy.rotation.set(0, tree.rotation, 0);
      dummy.scale.setScalar(tree.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [trees, dummy, invalidate]);

  // Char (instance colour) changes whenever observed fire does.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    trees.forEach((tree, i) => {
      const b = treeBrightness(tree, burns.get(tree.cell));
      mesh.setColorAt(i, color.setRGB(b, b, b));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [trees, burns, color, invalidate]);

  if (trees.length === 0) return null;
  return (
    <instancedMesh
      key={trees.length}
      ref={meshRef}
      args={[geometry, material, trees.length]}
      frustumCulled={false}
      castShadow
      receiveShadow
    />
  );
}
