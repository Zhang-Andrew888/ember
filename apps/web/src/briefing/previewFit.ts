import type { PublicPreview } from "./briefingInfo.js";
import { SCENE_SIZE } from "../map/worldScale.js";

export interface SceneBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface PreviewViewport {
  readonly width: number;
  readonly height: number;
  /** Horizontal inset in SVG units; must leave room for the labels drawn beside markers. */
  readonly padX: number;
  readonly padY: number;
}

export interface PreviewFrame {
  /** SVG units per scene unit. */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const FULL_SCENE_BOUNDS: SceneBounds = {
  minX: -SCENE_SIZE / 2,
  maxX: SCENE_SIZE / 2,
  minZ: -SCENE_SIZE / 2,
  maxZ: SCENE_SIZE / 2,
};

/** Smallest scene-space box around everything the preview draws, or null when it draws nothing. */
export function previewBounds(preview: PublicPreview): SceneBounds | null {
  const cellSize = SCENE_SIZE / preview.gridSize;
  const points: { x: number; z: number }[] = [];
  for (const road of preview.roads) points.push(...road.points);
  points.push(...preview.sites, ...preview.refuges);
  for (const cell of preview.initialFireCells) {
    const x = -SCENE_SIZE / 2 + (cell % preview.gridSize) * cellSize;
    const z = -SCENE_SIZE / 2 + Math.floor(cell / preview.gridSize) * cellSize;
    points.push({ x, z }, { x: x + cellSize, z: z + cellSize });
  }
  if (points.length === 0) return null;
  let bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const point of points) {
    bounds = {
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minZ: Math.min(bounds.minZ, point.z),
      maxZ: Math.max(bounds.maxZ, point.z),
    };
  }
  return bounds;
}

/** Uniform scale and offset that centre `bounds` inside the padded viewport without distortion. */
export function fitPreview(bounds: SceneBounds, viewport: PreviewViewport): PreviewFrame {
  const innerWidth = Math.max(1, viewport.width - 2 * viewport.padX);
  const innerHeight = Math.max(1, viewport.height - 2 * viewport.padY);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  const scale = Math.min(innerWidth / spanX, innerHeight / spanZ);
  return {
    scale,
    offsetX: viewport.padX + (innerWidth - spanX * scale) / 2 - bounds.minX * scale,
    offsetY: viewport.padY + (innerHeight - spanZ * scale) / 2 - bounds.minZ * scale,
  };
}
