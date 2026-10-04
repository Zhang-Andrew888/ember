import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_CONFIG } from "./types.js";
import { bucketTravelMs, offRoadTravelMs } from "./travel.js";

describe("travel timing (#120)", () => {
  it("charges twice the road time for the same distance off-road", () => {
    const distanceM = 360.555;
    const roadMs = bucketTravelMs(distanceM, DEFAULT_NAV_CONFIG);
    const offMs = offRoadTravelMs(distanceM, DEFAULT_NAV_CONFIG);
    const exactRoadSec = distanceM / DEFAULT_NAV_CONFIG.speedMps;
    expect(exactRoadSec * 2).toBeCloseTo((distanceM / (DEFAULT_NAV_CONFIG.speedMps * 0.5)) , 6);
    expect(offMs).toBe(Math.ceil((exactRoadSec * 2 * 1000) / DEFAULT_NAV_CONFIG.bucketMs) * DEFAULT_NAV_CONFIG.bucketMs);
    expect(offMs).toBeGreaterThanOrEqual(roadMs * 2 - DEFAULT_NAV_CONFIG.bucketMs);
    expect(offMs).toBeLessThanOrEqual(roadMs * 2 + DEFAULT_NAV_CONFIG.bucketMs);
  });
});
