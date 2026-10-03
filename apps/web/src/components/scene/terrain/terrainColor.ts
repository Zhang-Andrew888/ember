/**
 * Dusk palette for the ground: muted sage where fuel/vegetation is dense,
 * ochre where it is sparse, lifted slightly with elevation in quiet bands.
 * Pure so it can be tested; the Terrain mesh bakes it into vertex colours.
 */
export type Rgb = readonly [number, number, number];

const OCHRE: Rgb = [0.56, 0.46, 0.25];
const SAGE: Rgb = [0.3, 0.46, 0.27];
const DEEP: Rgb = [0.12, 0.3, 0.2];
const BAND_COUNT = 6;
const BAND_LIFT = 0.035;

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** @param density 0 (sparse) .. 1 (dense) @param elevation01 0 (low) .. 1 (high) */
export function terrainColor(density: number, elevation01: number): Rgb {
  const d = Math.min(1, Math.max(0, density));
  const base = d < 0.5 ? mix(OCHRE, SAGE, d / 0.5) : mix(SAGE, DEEP, (d - 0.5) / 0.5);
  const band = Math.floor(Math.min(0.999, Math.max(0, elevation01)) * BAND_COUNT);
  const lift = band * BAND_LIFT;
  return [base[0] + lift, base[1] + lift, base[2] + lift];
}

/** Maps a fuel multiplier (scenario range ~0.6-1.4) to density 0..1. */
export function fuelDensity(fuel: number): number {
  return Math.min(1, Math.max(0, (fuel - 0.6) / 0.8));
}
