/**
 * Rothermel-style surface fire spread, reduced to what a 1 Hz game step needs.
 *
 * It follows the structure of Rothermel (1972) with the Albini (1976) corrections: a no-wind,
 * no-slope rate R0 from reaction intensity over heat sink, multiplied by (1 + wind + slope)
 * factors, with directional spread taken from an Anderson-style ellipse. Each fuel model is a
 * single dead-fuel class (no live fuel, no size-class weighting), so it is a simplification
 * for gameplay, not a validated fire-behavior predictor. Inputs are in the original imperial
 * units; the exported helpers convert to the game's metric units.
 */

export interface FuelModel {
  readonly name: string;
  /** Surface-area-to-volume ratio, 1/ft. */
  readonly sigma: number;
  /** Oven-dry fuel load, lb/ft^2. */
  readonly w0: number;
  /** Fuel bed depth, ft. */
  readonly depth: number;
  /** Moisture of extinction, fraction of dry weight. */
  readonly mx: number;
  /** Whether the fuel carries a tree canopy that can crown. */
  readonly canopy: boolean;
}

/** Index into FUEL_MODELS; stored per cell as a byte. */
export const FUEL_GRASS = 0;
export const FUEL_SHRUB = 1;
export const FUEL_TIMBER = 2;

/** Simplified single-class analogues of Anderson models 1 (short grass), 5 (brush) and 8 (timber litter). */
export const FUEL_MODELS: readonly FuelModel[] = [
  { name: "grass", sigma: 3500, w0: 0.034, depth: 1.0, mx: 0.15, canopy: false },
  { name: "shrub", sigma: 2000, w0: 0.046, depth: 2.0, mx: 0.2, canopy: false },
  { name: "timber", sigma: 2000, w0: 0.12, depth: 0.6, mx: 0.3, canopy: true },
];

const PARTICLE_DENSITY = 32; // lb/ft^3
const HEAT_CONTENT = 8000; // BTU/lb
const MINERAL_TOTAL = 0.0555;
const MINERAL_EFFECTIVE = 0.01;
const FT_PER_MIN_PER_MPS = 196.85;

/** Optimum reaction velocity-based reaction intensity IR, BTU/ft^2/min (Rothermel 1972 eq. 27). */
export function reactionIntensity(fuel: FuelModel, moisture: number): number {
  const { sigma, w0, depth, mx } = fuel;
  const beta = w0 / (depth * PARTICLE_DENSITY);
  const ratio = beta / (3.348 * sigma ** -0.8189);
  const gammaMax = sigma ** 1.5 / (495 + 0.0594 * sigma ** 1.5);
  const a = 133 * sigma ** -0.7913;
  const gamma = gammaMax * ratio ** a * Math.exp(a * (1 - ratio));
  const wn = w0 / (1 + MINERAL_TOTAL);
  const etaS = Math.min(1, 0.174 * MINERAL_EFFECTIVE ** -0.19);
  const rm = Math.min(1, moisture / mx);
  const etaM = Math.max(0, 1 - 2.59 * rm + 5.11 * rm * rm - 3.52 * rm * rm * rm);
  return gamma * wn * HEAT_CONTENT * etaM * etaS;
}

/** Rate of spread with no wind and no slope, ft/min (Rothermel 1972 eq. 1 without the phi terms). */
export function noWindRateFtMin(fuel: FuelModel, moisture: number): number {
  const { sigma, w0, depth } = fuel;
  const beta = w0 / (depth * PARTICLE_DENSITY);
  const xi = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) / (192 + 0.2595 * sigma);
  const rhoBulk = w0 / depth;
  const epsilon = Math.exp(-138 / sigma);
  const heatOfIgnition = 250 + 1116 * moisture;
  return (reactionIntensity(fuel, moisture) * xi) / (rhoBulk * epsilon * heatOfIgnition);
}

/** BTU/ft/s to kW/m. */
const BTU_FT_S_TO_KW_M = 3.4613;

/**
 * Byram fireline intensity in kW/m for a spread rate in m/s: reaction intensity times flame residence
 * time (Albini: 384/sigma minutes) times the rate. Pass the rate the game actually uses, so intensity
 * stays consistent with spread; it is a game-scale figure, not a predicted physical one.
 */
export function firelineIntensityKwM(fuel: FuelModel, moisture: number, rateMps: number): number {
  const residenceMin = 384 / fuel.sigma;
  const btuPerFtMin = reactionIntensity(fuel, moisture) * residenceMin * (Math.max(0, rateMps) * FT_PER_MIN_PER_MPS);
  return (btuPerFtMin / 60) * BTU_FT_S_TO_KW_M;
}

/** Van Wagner (1977) critical surface intensity in kW/m that lifts fire into the canopy. */
export function crownInitiationKwM(canopyBaseHeightM: number, foliarMoisturePct: number): number {
  return (0.01 * canopyBaseHeightM * (460 + 25.9 * foliarMoisturePct)) ** 1.5;
}

/** Fireline intensity in kW/m per m/s of spread rate for a fuel and moisture (intensity is linear in rate). */
export function intensityPerMps(fuel: FuelModel, moisture: number): number {
  return firelineIntensityKwM(fuel, moisture, 1);
}

/** Byram flame length in meters from fireline intensity in kW/m (L = 0.0775 I^0.46). */
export function flameLengthM(intensityKwM: number): number {
  return 0.0775 * Math.max(0, intensityKwM) ** 0.46;
}

/** Wind coefficient phi_w for a midflame wind in m/s (Rothermel 1972 eq. 47). */
export function rothermelPhiW(fuel: FuelModel, windMps: number): number {
  if (windMps <= 0) return 0;
  const { sigma, w0, depth } = fuel;
  const beta = w0 / (depth * PARTICLE_DENSITY);
  const ratio = beta / (3.348 * sigma ** -0.8189);
  const c = 7.47 * Math.exp(-0.133 * sigma ** 0.55);
  const b = 0.02526 * sigma ** 0.54;
  const e = 0.715 * Math.exp(-3.59e-4 * sigma);
  return c * (windMps * FT_PER_MIN_PER_MPS) ** b * ratio ** -e;
}

/** Slope coefficient phi_s for an uphill slope given as rise/run (Rothermel 1972 eq. 51). Zero downhill. */
export function rothermelPhiS(fuel: FuelModel, slope: number): number {
  if (slope <= 0) return 0;
  const beta = fuel.w0 / (fuel.depth * PARTICLE_DENSITY);
  return 5.275 * beta ** -0.3 * slope * slope;
}

/**
 * Eccentricity of the head-fire ellipse from the midflame wind in m/s scaled by `windFactor20ft` to a 20-ft
 * wind (Anderson 1983 length-to-breadth ratio). Zero wind gives a circle.
 */
export function ellipseEccentricity(windMps: number, windFactor20ft: number): number {
  const mph = Math.max(0, windMps) * windFactor20ft * 2.23694;
  const lb = Math.max(1, 0.936 * Math.exp(0.2566 * mph) + 0.461 * Math.exp(-0.1548 * mph) - 0.397);
  return Math.sqrt(1 - 1 / (lb * lb));
}

/**
 * Directional factor on the head rate for a heading `cosTheta` away from the wind direction, with the
 * ignition point at the ellipse focus: (1 - e) / (1 - e cos(theta)).
 */
export function ellipseFactor(eccentricity: number, cosTheta: number): number {
  return (1 - eccentricity) / (1 - eccentricity * cosTheta);
}
