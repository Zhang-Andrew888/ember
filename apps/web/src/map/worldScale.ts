/**
 * Sim-world metres -> scene units. The sim world is a square grid (default
 * 64 x 25 m = 1600 m); the scene is 1400 units across, centred on the origin,
 * with sim y mapping to scene z.
 */
export const SCENE_SIZE = 1400;
export const DEFAULT_WORLD_METERS = 1600;

export interface SceneVector {
  readonly x: number;
  readonly z: number;
}

export function worldToScene(xMeters: number, yMeters: number, worldMeters = DEFAULT_WORLD_METERS): SceneVector {
  const scale = SCENE_SIZE / worldMeters;
  return { x: (xMeters - worldMeters / 2) * scale, z: (yMeters - worldMeters / 2) * scale };
}
