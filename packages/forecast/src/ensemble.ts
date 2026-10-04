import { SIM_DEFAULTS } from "@ember/simulation/model";
import type { ForecastEnsemble } from "./types.js";

export type EnsembleValidity = "valid" | "empty" | "contradicted";

/** Explicit safety state, including malformed or externally constructed empty ensembles. */
export function ensembleValidity(ensemble: ForecastEnsemble | null): EnsembleValidity {
  if (ensemble === null || ensemble.members.length === 0) return ensemble?.reliability === "unreliable" ? "contradicted" : "empty";
  return ensemble.reliability === "reliable" ? "valid" : "contradicted";
}

/** Protection work is admitted only from a reliable, non-empty ensemble. */
export function admitsProtection(ensemble: ForecastEnsemble | null): boolean {
  return ensembleValidity(ensemble) === "valid";
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

const rankedCache = new WeakMap<ForecastEnsemble, Map<number, Float64Array>>();

/**
 * Per cell, the `rank`-th earliest ignition across retained members (1 = `earliestIgnitionMs`).
 * A rank above the member count uses the latest member.
 */
export function rankedIgnitionMs(ensemble: ForecastEnsemble, rank: number): Float64Array {
  const k = Math.max(1, Math.min(Math.floor(rank), ensemble.members.length));
  if (k <= 1) return earliestIgnitionMs(ensemble);
  let byRank = rankedCache.get(ensemble);
  const hit = byRank?.get(k);
  if (hit !== undefined) return hit;
  const n = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.gridSize;
  const out = new Float64Array(n);
  const values = new Float64Array(ensemble.members.length);
  for (let i = 0; i < n; i++) {
    for (let m = 0; m < ensemble.members.length; m++) values[m] = ensemble.members[m]!.ignitionMs[i]!;
    values.sort();
    out[i] = values[k - 1]!;
  }
  if (byRank === undefined) rankedCache.set(ensemble, (byRank = new Map()));
  byRank.set(k, out);
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
