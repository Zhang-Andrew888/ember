import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, MeshLambertMaterial, MeshStandardMaterial, Uint32BufferAttribute } from "three";
import { useQuality } from "./quality/QualityContext.js";
import { sceneTerrain, waterCells, waterLevel } from "./terrain/sceneTerrain.js";
import { fuelDensity, terrainColor } from "./terrain/terrainColor.js";
import { SCENE_SIZE } from "../../map/worldScale.js";
import { applyFireLight } from "./fire/fireLight.js";

/**
 * Low-poly ground from the scenario's public height and fuel layers
 * (corner grid, flat-shaded, vertex-coloured by vegetation density and
 * quiet elevation bands) plus water in the basins. No textures or assets.
 */
export function Terrain() {
  const geometry = useMemo(() => {
    const field = sceneTerrain;
    const n = field.gridSize;
    const stride = n + 1;
    const half = SCENE_SIZE / 2;
    const positions = new Float32Array(stride * stride * 3);
    const colors = new Float32Array(stride * stride * 3);
    for (let cz = 0; cz <= n; cz++) {
      for (let cx = 0; cx <= n; cx++) {
        const i = cz * stride + cx;
        const height = field.corners[i]!;
        positions.set([cx * field.cellSize - half, height, cz * field.cellSize - half], i * 3);
        // Vegetation density at the nearest cell (clamped at the border).
        const fx = Math.min(n - 1, cx);
        const fz = Math.min(n - 1, cz);
        const density = fuelDensity(field.fuel[fz * n + fx]!);
        colors.set(terrainColor(density, field.maxHeight > 0 ? height / field.maxHeight : 0), i * 3);
      }
    }
    const indices = new Uint32Array(n * n * 6);
    let k = 0;
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) {
        const a = cz * stride + cx;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.set([a, c, b, b, c, d], k);
        k += 6;
      }
    }
    const geo = new BufferGeometry();
    geo.setIndex(new Uint32BufferAttribute(indices, 1));
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const cheap = useQuality().cheapLighting;
  const groundMaterial = useMemo(() => {
    // The ground covers the whole canvas, so its per-pixel cost dominates on weak GPUs: Lambert on cheaper tiers.
    const material = cheap
      ? new MeshLambertMaterial({ vertexColors: true, flatShading: true })
      : new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
    applyFireLight(material, false, true);
    return material;
  }, [cheap]);
  useEffect(() => () => groundMaterial.dispose(), [groundMaterial]);

  return (
    <>
      <mesh geometry={geometry} receiveShadow>
        <primitive object={groundMaterial} attach="material" />
      </mesh>
      <Water />
    </>
  );
}

/** One merged quad per wet grid cell, just below the cell's surrounding shore. */
function Water() {
  const geometry = useMemo(() => {
    const size = sceneTerrain.cellSize;
    const positions = new Float32Array(waterCells.length * 12);
    const indices = new Uint32Array(waterCells.length * 6);
    waterCells.forEach((cell, i) => {
      const c = sceneTerrain.cellCenter(cell);
      const h = size / 2;
      positions.set(
        [c.x - h, waterLevel, c.z - h, c.x + h, waterLevel, c.z - h, c.x - h, waterLevel, c.z + h, c.x + h, waterLevel, c.z + h],
        i * 12,
      );
      const v = i * 4;
      indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    });
    const geo = new BufferGeometry();
    geo.setIndex(new Uint32BufferAttribute(indices, 1));
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (waterCells.length === 0) return null;
  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshStandardMaterial color="#2f7088" roughness={0.25} metalness={0.1} transparent opacity={0.85} />
    </mesh>
  );
}
