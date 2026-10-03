import type { NavConfig } from "./types.js";

/** Travel time for a road length, rounded up to whole planning buckets. */
export function bucketTravelMs(lengthM: number, config: NavConfig): number {
  const exact = (lengthM / config.speedMps) * 1000;
  return Math.ceil(exact / config.bucketMs) * config.bucketMs;
}
