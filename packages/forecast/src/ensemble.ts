import { SIM_DEFAULTS } from "@ember/simulation/model";
import type { ForecastEnsemble } from "./types.js";

/** Protection work is admitted only from a reliable, non-empty ensemble. */
export function admitsProtection(ensemble: ForecastEnsemble | null): boolean {
  return ensemble !== null && ensemble.reliability === "reliable" && ensemble.members.length > 0;
}

const earliestCache = new WeakMap<ForecastEnsemble, Float64Array>();

/** Per cell, the earliest ignition across every retained member (the planning constraint). */
export function earliestIgnitionMs(ensemble: ForecastEnsemble): Float64Array {
  const hit = earliestCache.get(ensemble);
  if (hit !== undefined) return hit;
  const n = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.gridSize;
  const out = new Float64Array(n).fill(Infinity);
  for (const m of ensemble.members) {
    for (let i = 0; i < n; i++) {
      const v = m.ignitionMs[i]!;
      if (v < out[i]!) out[i] = v;
    }
  }
  earliestCache.set(ensemble, out);
  return out;
}

/**
 * Fraction of retained members with each cell burning or burned at tMs, for uncertainty
 * display. It counts finite design members and is not a validated probability.
 */
export function burnFractionAt(ensemble: ForecastEnsemble, tMs: number): Float32Array {
  const n = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.gridSize;
  const out = new Float32Array(n);
  const count = ensemble.members.length;
  if (count === 0) return out;
  for (const m of ensemble.members) {
    for (let i = 0; i < n; i++) if (m.ignitionMs[i]! <= tMs) out[i] = out[i]! + 1;
  }
  for (let i = 0; i < n; i++) out[i] = out[i]! / count;
  return out;
}
