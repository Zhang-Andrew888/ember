import type { AgentPosition } from "@ember/domain";
import type { ScenarioMap } from "./scenarioMap.js";
import { SCENE_SIZE, worldToScene, type SceneVector } from "./worldScale.js";
import { resolveAgentPosition } from "./positions.js";

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** Scene units (x, z on the ground plane) → simulation world metres (x, y). */
export function sceneToWorld(x: number, z: number, worldMeters: number): WorldPoint {
  const factor = SCENE_SIZE / worldMeters;
  return { x: x / factor + worldMeters / 2, y: z / factor + worldMeters / 2 };
}

export function scenePointToWorld(point: SceneVector, worldMeters: number): WorldPoint {
  return sceneToWorld(point.x, point.z, worldMeters);
}

export function agentWorldPoint(map: ScenarioMap, position: AgentPosition): WorldPoint | null {
  const scene = resolveAgentPosition(map, position);
  if (scene === null) return null;
  return sceneToWorld(scene.x, scene.z, map.worldMeters);
}

export function worldToScenePoint(point: WorldPoint, worldMeters: number): SceneVector {
  return worldToScene(point.x, point.y, worldMeters);
}
