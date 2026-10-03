import type { Rng} from "@ember/simulation/model";
import { type FireParams } from "@ember/simulation/model";
import type { ForecastConfig } from "./config.js";
import { rolloutEndFor, rolloutIgnition, type RolloutContext } from "./rollout.js";
import type { ForecastMember, MemberKind, ParameterRanges } from "./types.js";

const RAD = Math.PI / 180;
const NO_SHIFT_MS = 1e9;

export function paramsFrom(
  mult: number,
  windOffsetDeg: number,
  shiftMs: number,
  postShiftDeg: number,
  initialProgress: number,
): FireParams {
  return {
    spreadMultiplier: mult,
    initialWindRad: windOffsetDeg * RAD,
    windShiftMs: shiftMs,
    postShiftWindRad: postShiftDeg * RAD,
    initialProgress,
  };
}

export function buildMember(
  ctx: RolloutContext,
  config: ForecastConfig,
  id: string,
  kind: MemberKind,
  params: FireParams,
  horizonEndMs: number,
): ForecastMember {
  return {
    id,
    kind,
    params,
    ignitionMs: rolloutIgnition(ctx, params, horizonEndMs, config.rolloutStepMs),
    rolloutEndMs: rolloutEndFor(horizonEndMs),
  };
}

/**
 * A member rolled out only to `untilMs`. Its predictions for any time up to `untilMs` equal a full
 * rollout's, so it can screen a candidate against observations at a fraction of the cost.
 */
export function probeMember(ctx: RolloutContext, config: ForecastConfig, c: { id: string; kind: MemberKind; params: FireParams }, untilMs: number): ForecastMember {
  return {
    id: c.id,
    kind: c.kind,
    params: c.params,
    ignitionMs: rolloutIgnition(ctx, c.params, untilMs + config.rolloutStepMs, config.rolloutStepMs, true),
    rolloutEndMs: untilMs,
  };
}

/** Parameter descriptions without rollouts, so candidates can be screened cheaply. */
export interface Candidate {
  readonly id: string;
  readonly kind: MemberKind;
  readonly params: FireParams;
}

/**
 * Box corners over the four uncertain parameters, with the initial-front progress alternating
 * between its two extremes. These are the predefined boundary cases.
 */
export function boundaryCandidates(ranges: ParameterRanges, prefix: string): Candidate[] {
  const out: Candidate[] = [];
  let i = 0;
  for (const mult of [ranges.spreadMultiplier.min, ranges.spreadMultiplier.max]) {
    for (const wind of [ranges.windOffsetDeg.min, ranges.windOffsetDeg.max]) {
      for (const shift of [ranges.shiftTimeMs.min, ranges.shiftTimeMs.max]) {
        const post = i % 2 === 0 ? ranges.postShiftDeg.min : ranges.postShiftDeg.max;
        out.push({ id: `${prefix}-b${i}`, kind: "boundary", params: paramsFrom(mult, wind, shift, post, i % 2 === 0 ? 0 : 0.5) });
        i += 1;
      }
    }
  }
  return out;
}

/** Cases where the wind never shifts inside the horizon. */
export function noShiftCandidates(ranges: ParameterRanges, prefix: string): Candidate[] {
  const m = ranges.spreadMultiplier;
  const w = ranges.windOffsetDeg;
  const mid = (m.min + m.max) / 2;
  const specs: [number, number][] = [
    [m.min, w.min],
    [m.max, w.max],
    [mid, 0],
    [m.max, w.min],
  ];
  return specs.map(([mult, wind], i) => ({
    id: `${prefix}-n${i}`,
    kind: "no_shift" as const,
    params: paramsFrom(mult, wind, NO_SHIFT_MS, (ranges.postShiftDeg.min + ranges.postShiftDeg.max) / 2, 0),
  }));
}

export function sampledCandidates(
  ranges: ParameterRanges,
  rng: Rng,
  count: number,
  prefix: string,
  kind: MemberKind = "sampled",
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `${prefix}-s${i}`,
      kind,
      params: paramsFrom(
        rng.range(ranges.spreadMultiplier.min, ranges.spreadMultiplier.max),
        rng.range(ranges.windOffsetDeg.min, ranges.windOffsetDeg.max),
        Math.round(rng.range(ranges.shiftTimeMs.min, ranges.shiftTimeMs.max) / 1000) * 1000,
        rng.range(ranges.postShiftDeg.min, ranges.postShiftDeg.max),
        rng.range(0, 0.5),
      ),
    });
  }
  return out;
}

/** The public prior: boundary cases, no-shift cases, and seeded samples up to memberCount. */
export function priorCandidates(config: ForecastConfig, rng: Rng, prefix: string): Candidate[] {
  const boundary = boundaryCandidates(config.prior, prefix);
  const noShift = noShiftCandidates(config.prior, prefix);
  const rest = Math.max(0, config.memberCount - boundary.length - noShift.length);
  return [...boundary, ...noShift, ...sampledCandidates(config.prior, rng, rest, prefix)];
}

export function perturb(base: FireParams, rng: Rng, bounds: ParameterRanges, id: string): Candidate {
  const clamp = (v: number, r: { min: number; max: number }): number => Math.min(r.max, Math.max(r.min, v));
  const shift = Number.isFinite(base.windShiftMs) && base.windShiftMs < NO_SHIFT_MS / 2;
  return {
    id,
    kind: "replenished",
    params: paramsFrom(
      clamp(base.spreadMultiplier * (1 + rng.range(-0.05, 0.05)), bounds.spreadMultiplier),
      clamp(base.initialWindRad / RAD + rng.range(-3, 3), bounds.windOffsetDeg),
      shift ? clamp(base.windShiftMs + rng.range(-15_000, 15_000), bounds.shiftTimeMs) : NO_SHIFT_MS,
      clamp(base.postShiftWindRad / RAD + rng.range(-3, 3), bounds.postShiftDeg),
      Math.min(0.5, Math.max(0, (base.initialProgress ?? 0) + rng.range(-0.05, 0.05))),
    ),
  };
}

const EXTREME_KEYS = ["spreadMultiplier", "initialWindRad", "windShiftMs", "postShiftWindRad", "initialProgress"] as const;

/** Ids of members attaining a minimum or maximum of any uncertain parameter. */
export function extremeIds(members: readonly ForecastMember[]): Set<string> {
  const out = new Set<string>();
  for (const key of EXTREME_KEYS) {
    let lo: ForecastMember | undefined;
    let hi: ForecastMember | undefined;
    for (const m of members) {
      const v = m.params[key] ?? 0;
      if (lo === undefined || v < (lo.params[key] ?? 0)) lo = m;
      if (hi === undefined || v > (hi.params[key] ?? 0)) hi = m;
    }
    if (lo !== undefined) out.add(lo.id);
    if (hi !== undefined) out.add(hi.id);
  }
  return out;
}
