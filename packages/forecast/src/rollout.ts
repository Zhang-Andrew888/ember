import { FireField, SIM_DEFAULTS, createTerrain, refugeCells, RoadIndex, type PublicMap, type Terrain } from "@ember/simulation/model";
import { hashValue } from "@ember/knowledge";
import { forecastStep } from "./dynamics.js";
import type { ForecastParams } from "./types.js";

/** Public inputs a rollout needs. Contains no truth: terrain and patch are briefed. */
export interface RolloutContext {
  readonly key: string;
  readonly terrain: Terrain;
  readonly nonburnable: ReadonlySet<number>;
  readonly initialCells: readonly number[];
}

const contexts = new Map<string, RolloutContext>();

export function rolloutContext(map: PublicMap): RolloutContext {
  const key = hashValue({ t: map.terrainSeed, f: map.initialFireCells, r: map.refuges, n: map.nodes.length });
  const hit = contexts.get(key);
  if (hit !== undefined) return hit;
  const road = new RoadIndex(map);
  const ctx: RolloutContext = {
    key,
    terrain: createTerrain(map.terrainSeed),
    nonburnable: refugeCells(road, SIM_DEFAULTS.refugeRadiusM),
    initialCells: map.initialFireCells,
  };
  contexts.set(key, ctx);
  return ctx;
}

/** A field already rolled out to `atMs` for the same context and parameters; consumed by the rollout. */
export interface WarmRollout {
  readonly field: FireField;
  readonly atMs: number;
  readonly stepMs: number;
}

interface Cached {
  endMs: number;
  ign: Float64Array;
}

const cache = new Map<string, Cached>();
const CACHE_LIMIT = 600;
const ROUND_MS = 300_000;
/** Roll out once to cover the whole incident plus the forecast horizon, so refreshes hit the cache. */
const ROLLOUT_FLOOR_MS = 3_300_000;

function paramKey(ctx: RolloutContext, p: ForecastParams, stepMs: number): string {
  const r = (v: number): string => (Number.isFinite(v) ? v.toFixed(5) : "inf");
  return [ctx.key, r(p.spreadMultiplier), r(p.initialWindRad), r(p.windShiftMs), r(p.postShiftWindRad), r(p.initialProgress ?? 0), r(p.moistureMultiplier ?? 1), r(p.spotDistanceCells ?? 0), r(p.spotTimeMs ?? Infinity), stepMs].join("|");
}

/**
 * Per-cell first ignition times for one hypothesis, rolled out from the briefed initial patch.
 * Ignition is recorded at the start of the step in which it happens, so timing errs early
 * (conservative). Results are cached per parameter set and extended on demand.
 */
export function rolloutIgnition(
  ctx: RolloutContext,
  params: ForecastParams,
  endMs: number,
  stepMs: number,
  exact = false,
  warm?: WarmRollout,
): Float64Array {
  const key = paramKey(ctx, params, stepMs);
  const hit = cache.get(key);
  if (hit !== undefined && hit.endMs >= endMs) return hit.ign;
  // `exact` rolls out only as far as asked: a cheap probe whose early times are identical to a full rollout.
  const target = exact ? Math.ceil(endMs / stepMs) * stepMs : Math.max(ROLLOUT_FLOOR_MS, Math.ceil(endMs / ROUND_MS) * ROUND_MS);
  // A warm start continues a field already stepped from the same start with the same parameters, so
  // the result is identical to rolling out from zero.
  const resume = warm !== undefined && warm.stepMs === stepMs && warm.atMs <= target;
  const field = resume ? warm.field : new FireField(ctx.terrain, ctx.nonburnable);
  if (!resume) field.ignite(ctx.initialCells, 0, params.initialProgress ?? 0);
  for (let t = resume ? warm.atMs + stepMs : stepMs; t <= target; t += stepMs) forecastStep(field, t, stepMs, params);
  const ign = new Float64Array(field.ignitedAtMs.length);
  for (let i = 0; i < ign.length; i++) {
    const v = field.ignitedAtMs[i]!;
    ign[i] = v === 0 || !Number.isFinite(v) ? v : Math.max(0, v - stepMs);
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, { endMs: target, ign });
  return ign;
}

export function rolloutEndFor(endMs: number): number {
  return Math.max(ROLLOUT_FLOOR_MS, Math.ceil(endMs / ROUND_MS) * ROUND_MS);
}
