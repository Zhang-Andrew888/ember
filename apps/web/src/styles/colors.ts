/**
 * Shared color tokens from docs/FRONTEND.md "Art and color". Kept as plain
 * TS constants (not CSS-only) so Three.js materials and DOM elements use
 * the exact same values - duplicated as CSS custom properties in
 * styles/global.css for anything that's pure CSS.
 */
export const colors = {
  background: "#11191C",
  panel: "#1B272B",
  text: "#F1F4ED",
  observedFire: "#FF6B35",
  forecastEnvelope: "#FFC98B",
  refuge: "#70D6D1",
  rejected: "#C1443B",
  staleOutline: "#5B6A6D",
  terrainSage: "#6E8168",
  terrainOchre: "#9C8252",
  road: "#39454A",
  /** Observed belief (crew sightings, possibly old): drawn as an outlined frame, never a solid fire tile. */
  observedBelief: "#CFE3E0",
} as const;
