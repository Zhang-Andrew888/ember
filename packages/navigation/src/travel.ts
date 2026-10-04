import type { NavConfig } from "./types.js";

/** Travel time for a road length, rounded up to whole planning buckets. */
export function bucketTravelMs(lengthM: number, config: NavConfig): number {
  const exact = (lengthM / config.speedMps) * 1000;
  return Math.ceil(exact / config.bucketMs) * config.bucketMs;
}

export function offRoadSpeedMps(config: NavConfig): number {
  return config.offRoadSpeedMps ?? config.speedMps * 0.5;
}

/** Off-road legs use half speed → twice the travel time for the same distance. */
export function offRoadTravelMs(lengthM: number, config: NavConfig): number {
  const exact = (lengthM / offRoadSpeedMps(config)) * 1000;
  return Math.ceil(exact / config.bucketMs) * config.bucketMs;
}
