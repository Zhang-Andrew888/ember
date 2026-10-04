import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, MeshLambertMaterial, MeshStandardMaterial, SRGBColorSpace, Uint32BufferAttribute } from "three";
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
export function Terrain({
  tilePickEnabled,
  onSelectTile,
}: {
  readonly tilePickEnabled: boolean;
  readonly onSelectTile: (gridCellIndex: number) => void;
}) {
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

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!tilePickEnabled) return;
    const index = sceneTerrain.cellIndexAt(event.point.x, event.point.z);
    if (index === null) return;
    event.stopPropagation();
    onSelectTile(index);
  };

  return (
    <>
      <mesh geometry={geometry} receiveShadow onPointerDown={handlePointerDown}>
        <primitive object={groundMaterial} attach="material" />
      </mesh>
      <Water tilePickEnabled={tilePickEnabled} onSelectTile={onSelectTile} />
      <Apron />
    </>
  );
}

/** Ground beyond the map fades from a dim edge tone to near-black, so it reads as the map's surround. */
const APRON_OUTER = [0.086, 0.125, 0.114] as const;
const APRON_SPAN = 3; // the apron is this many map-widths across
const APRON_TEXTURE_SIZE = 128;

function createApronTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = APRON_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const inner = terrainColor(0.35, 0.3);
  const edge = [inner[0] * 0.5, inner[1] * 0.5, inner[2] * 0.5];
  const image = ctx.createImageData(APRON_TEXTURE_SIZE, APRON_TEXTURE_SIZE);
  const half = APRON_TEXTURE_SIZE / 2;
  const innerHalf = half / APRON_SPAN; // the map's own footprint, half-width in texels
  const fade = half - innerHalf;
  for (let y = 0; y < APRON_TEXTURE_SIZE; y++) {
    for (let x = 0; x < APRON_TEXTURE_SIZE; x++) {
      const dx = Math.abs(x + 0.5 - half) - innerHalf;
      const dy = Math.abs(y + 0.5 - half) - innerHalf;
      const t = Math.min(1, Math.max(0, Math.max(dx, dy) / fade));
      const k = t * t * (3 - 2 * t); // smoothstep
      const o = (y * APRON_TEXTURE_SIZE + x) * 4;
      for (let c = 0; c < 3; c++) image.data[o + c] = Math.round(255 * (edge[c]! + (APRON_OUTER[c]! - edge[c]!) * k));
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * A large unlit plane just below the lowest terrain corner. Without it, wide canvases show hard
 * background-coloured bands past the map edge (issue #52); with it, the edge fades out softly.
 */
function Apron() {
  const y = useMemo(() => {
    let lowest = Infinity;
    for (const height of sceneTerrain.corners) lowest = Math.min(lowest, height);
    return (Number.isFinite(lowest) ? lowest : 0) - 2;
  }, []);
  const texture = useMemo(createApronTexture, []);
  useEffect(() => () => texture?.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
      <planeGeometry args={[SCENE_SIZE * APRON_SPAN, SCENE_SIZE * APRON_SPAN]} />
      <meshBasicMaterial color={texture ? "#ffffff" : "#16201d"} map={texture} fog={false} />
    </mesh>
  );
}

/** One merged quad per wet grid cell, just below the cell's surrounding shore. */
function Water({
  tilePickEnabled,
  onSelectTile,
}: {
  readonly tilePickEnabled: boolean;
  readonly onSelectTile: (gridCellIndex: number) => void;
}) {
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
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!tilePickEnabled) return;
    const index = sceneTerrain.cellIndexAt(event.point.x, event.point.z);
    if (index === null) return;
    event.stopPropagation();
    onSelectTile(index);
  };

  if (waterCells.length === 0) return null;
  return (
    <mesh geometry={geometry} renderOrder={1} onPointerDown={handlePointerDown}>
      <meshStandardMaterial color="#2f7088" roughness={0.25} metalness={0.1} transparent opacity={0.85} />
    </mesh>
  );
}
