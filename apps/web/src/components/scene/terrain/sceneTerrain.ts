import { scenarioMap } from "../../../map/activeScenario.js";
import { createHeightField, type HeightField } from "./heightField.js";

/** The active scenario's terrain, shared by every scene layer so everything sits on the same ground. */
export const sceneTerrain: HeightField = createHeightField(scenarioMap.terrain);

/**
 * Water fills the lowest ground. The level is chosen from the field (a low
 * quantile of cell heights), so ponds always exist in basins and never
 * depend on authored coordinates.
 */
export function chooseWaterLevel(heightField: HeightField, quantile = 0.035): number {
  const heights = Array.from({ length: heightField.gridSize ** 2 }, (_, i) => heightField.cellHeight(i)).sort(
    (a, b) => a - b,
  );
  return heights[Math.floor(heights.length * quantile)] ?? 0;
}

export const waterLevel = chooseWaterLevel(sceneTerrain);

/** Scene units of dry ground kept around every road polyline and node. */
export const WATER_ROAD_CLEARANCE = 60;

/**
 * Grid cells that hold water: ground below `level`, and nowhere near a
 * road or node (a pond must never swallow the thing the map is about).
 */
export function chooseWaterCells(
  heightField: HeightField,
  level: number,
  roadPoints: ReadonlyArray<{ readonly x: number; readonly z: number }>,
  clearance = WATER_ROAD_CLEARANCE,
): number[] {
  const wet: number[] = [];
  for (let i = 0; i < heightField.gridSize ** 2; i++) {
    if (heightField.cellHeight(i) >= level) continue;
    const centre = heightField.cellCenter(i);
    const blocked = roadPoints.some((p) => Math.hypot(p.x - centre.x, p.z - centre.z) < clearance + heightField.cellSize);
    if (!blocked) wet.push(i);
  }
  return wet;
}

/** Densely sampled road + node points (so a long straight edge still blocks the cells beside it). */
export function roadSamplePoints(step = 20): Array<{ x: number; z: number }> {
  const points: Array<{ x: number; z: number }> = [];
  for (const node of scenarioMap.nodes.values()) points.push({ x: node.x, z: node.z });
  for (const edge of scenarioMap.edges.values()) {
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!;
      const b = edge.points[i]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
      for (let k = 0; k <= steps; k++) {
        points.push({ x: a.x + ((b.x - a.x) * k) / steps, z: a.z + ((b.z - a.z) * k) / steps });
      }
    }
  }
  return points;
}

export const waterCells: readonly number[] = chooseWaterCells(sceneTerrain, waterLevel, roadSamplePoints());
