/** Spatial hash for "is this point within `radius` of any sample point". */
export interface ProximityTest {
  (x: number, z: number): boolean;
}

export function createProximityTest(
  points: ReadonlyArray<{ readonly x: number; readonly z: number }>,
  radius: number,
): ProximityTest {
  const cell = Math.max(1, radius);
  const buckets = new Map<string, Array<{ x: number; z: number }>>();
  const key = (ix: number, iz: number) => `${ix},${iz}`;
  for (const p of points) {
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    const bucket = buckets.get(k);
    if (bucket) bucket.push(p);
    else buckets.set(k, [p]);
  }
  const r2 = radius * radius;
  return (x, z) => {
    const ix = Math.floor(x / cell);
    const iz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = buckets.get(key(ix + dx, iz + dz));
        if (!bucket) continue;
        for (const p of bucket) {
          const ddx = p.x - x;
          const ddz = p.z - z;
          if (ddx * ddx + ddz * ddz < r2) return true;
        }
      }
    }
    return false;
  };
}
