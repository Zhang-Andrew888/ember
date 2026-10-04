import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Color, MeshLambertMaterial, MeshStandardMaterial, Object3D, type BufferGeometry, type InstancedMesh } from "three";
import { sceneTerrain, waterCells, roadSamplePoints } from "./terrain/sceneTerrain.js";
import { createProximityTest } from "./trees/roadMask.js";
import { burnByCell, placeTrees, treeBrightness, type CellBurn, type TreeInstance } from "./trees/treePlacement.js";
import { applySway, createPineGeometry, createSimpleTreeGeometry, createSpruceGeometry, type SwayUniforms } from "./trees/treeGeometry.js";
import { applyFireLight } from "./fire/fireLight.js";
import { sceneClock } from "./anim/sceneClock.js";
import { useQuality } from "./quality/QualityContext.js";
import type { FireCellMarker } from "./sceneEntities.js";

/** Wide enough to keep the forecast ribbon (up to 16 units each side of the road) and route clear of canopies. */
const ROAD_CLEARANCE = 26;

/**
 * Instanced conifers: two species, one draw call each. Density follows the
 * vegetation layer and the quality tier; trees in cells with observed fire
 * char and darken (colour is decoration here: fire status is also carried
 * by the flame cards and the inspection list).
 */
export function Trees({
  fireCells,
  clearedCells,
  reducedMotion,
}: {
  readonly fireCells: readonly FireCellMarker[];
  /** Cells cleared to bare ground (firebreaks): no trees stand there. */
  readonly clearedCells?: ReadonlySet<number>;
  readonly reducedMotion: boolean;
}) {
  const quality = useQuality();
  const invalidate = useThree((state) => state.invalidate);

  const blocked = useMemo(() => createProximityTest(roadSamplePoints(), ROAD_CLEARANCE), []);
  const placed = useMemo(
    () => placeTrees({ field: sceneTerrain, blocked, waterCells: new Set(waterCells), densityFactor: quality.treeDensity }),
    [blocked, quality.treeDensity],
  );
  const trees = useMemo(
    () => (clearedCells === undefined || clearedCells.size === 0 ? placed : placed.filter((t) => !clearedCells.has(t.cell))),
    [placed, clearedCells],
  );
  const bySpecies = useMemo(
    () => [trees.filter((t) => t.species === 0), trees.filter((t) => t.species === 1)] as const,
    [trees],
  );
  const burns = useMemo(() => burnByCell(fireCells), [fireCells]);

  // uSway scales the shared clock's displacement; 0 freezes the forest (low tier, reduced motion).
  const uniforms = useMemo<SwayUniforms>(() => ({ uTime: sceneClock.uTime, uSway: { value: 0 } }), []);
  const swaying = quality.sway && !reducedMotion;
  useEffect(() => {
    uniforms.uSway.value = swaying ? 1 : 0;
    invalidate();
  }, [swaying, uniforms, invalidate]);

  return (
    <>
      <TreeSpecies trees={bySpecies[0]} burns={burns} geometryFactory={quality.simpleTrees ? createSimpleTreeGeometry : createSpruceGeometry} uniforms={uniforms} cheap={quality.cheapLighting} />
      <TreeSpecies trees={bySpecies[1]} burns={burns} geometryFactory={quality.simpleTrees ? createSimpleTreeGeometry : createPineGeometry} uniforms={uniforms} cheap={quality.cheapLighting} />
    </>
  );
}

function TreeSpecies({
  trees,
  burns,
  geometryFactory,
  uniforms,
  cheap,
}: {
  readonly trees: readonly TreeInstance[];
  readonly burns: ReadonlyMap<number, CellBurn>;
  readonly geometryFactory: () => BufferGeometry;
  readonly uniforms: SwayUniforms;
  readonly cheap: boolean;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(geometryFactory, [geometryFactory]);
  const material = useMemo(() => {
    // Lambert on cheaper tiers: far less per-pixel work for the same flat-shaded look.
    const m = cheap
      ? new MeshLambertMaterial({ vertexColors: true, flatShading: true })
      : new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    applySway(m, uniforms);
    applyFireLight(m, true, false);
    return m;
  }, [uniforms, cheap]);
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
