import type { NavConfig } from "@ember/navigation";
import { z } from "zod";
import type { CrewAttributes } from "./crew-roles.js";

const unit = z.number().finite().min(0).max(1);

/** Per-member condition, each in [0, 1]. Fatigue and injury risk: higher is worse. Morale: lower is worse. */
export const MemberState = z.object({ fatigue: unit, injuryRisk: unit, morale: unit }).strict();
export type MemberState = z.infer<typeof MemberState>;

export const FRESH_MEMBER_STATE: MemberState = { fatigue: 0, injuryRisk: 0, morale: 1 };

export type Activity = "working" | "travelling" | "emergency" | "resting";

export interface Advance {
  /** Elapsed simulated ms (never wall time). */
  readonly dtMs: number;
  readonly activity: Activity;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Fatigue multiplier while working relative to travelling. */
const WORK_FATIGUE_FACTOR = 1.5;
const EMERGENCY_FATIGUE_FACTOR = 2;
/** Fatigue recovery per simulated minute at a refuge. */
const REST_RECOVERY_PER_MIN = 0.02;
/** Injury risk gained per simulated minute of emergency exposure; grows with fatigue. */
const INJURY_PER_EMERGENCY_MIN = 0.05;
/** Morale lost per simulated minute of emergency; regained slowly at rest but never above its prior ceiling. */
const MORALE_LOSS_PER_EMERGENCY_MIN = 0.08;
const MORALE_REST_PER_MIN = 0.005;

/**
 * Deterministic condition update. Injury risk never falls (an injury does not heal mid-incident)
 * and morale recovers only a little: the model errs toward the worse state.
 */
export function advanceMemberState(state: MemberState, attrs: CrewAttributes, step: Advance): MemberState {
  if (!(step.dtMs > 0)) return state;
  const min = step.dtMs / 60_000;
  let fatigue = state.fatigue;
  let injuryRisk = state.injuryRisk;
  let morale = state.morale;
  switch (step.activity) {
    case "resting":
      fatigue -= REST_RECOVERY_PER_MIN * min;
      morale += MORALE_REST_PER_MIN * min;
      break;
    case "travelling":
      fatigue += attrs.fatiguePerMin * min;
      break;
    case "working":
      fatigue += attrs.fatiguePerMin * WORK_FATIGUE_FACTOR * min;
      break;
    case "emergency":
      fatigue += attrs.fatiguePerMin * EMERGENCY_FATIGUE_FACTOR * min;
      injuryRisk += INJURY_PER_EMERGENCY_MIN * (1 + state.fatigue) * min;
      morale -= MORALE_LOSS_PER_EMERGENCY_MIN * min;
      break;
  }
  return { fatigue: clamp01(fatigue), injuryRisk: clamp01(Math.max(injuryRisk, state.injuryRisk)), morale: clamp01(morale) };
}

/** Worst-case multiplier on speed and work rate at full degradation. */
const MIN_PERFORMANCE = 0.5;
/** Extra buffer, as a fraction of the base buffer, at full degradation of each factor. */
const BUFFER_FATIGUE = 0.5;
const BUFFER_INJURY = 1;
const BUFFER_LOW_MORALE = 0.25;
/** A member within these bounds is rested enough that planning is unchanged; beyond them it tightens. */
const ONSET = { fatigue: 0.25, injuryRisk: 0.05, moraleLoss: 0.2 } as const;

/** 0 up to the onset, then rising linearly to 1: monotone in x. */
const ramp = (x: number, onset: number): number => (x <= onset ? 0 : clamp01((x - onset) / (1 - onset)));

/**
 * Feasibility inputs for a member in this condition. Every output is at least as strict as the
 * input: the buffer only grows, speed and work rate only shrink. Condition can make a mission
 * infeasible but can never admit one the fresh member would reject. Below the onset bounds the
 * member is treated as rested and the base config is returned unchanged.
 */
export function tightenNav(base: NavConfig, state: MemberState): NavConfig {
  const fatigue = ramp(state.fatigue, ONSET.fatigue);
  const injury = ramp(state.injuryRisk, ONSET.injuryRisk);
  const lowMorale = ramp(1 - state.morale, ONSET.moraleLoss);
  const degradation = Math.max(fatigue, injury, lowMorale);
  const perf = 1 - (1 - MIN_PERFORMANCE) * degradation;
  const bufferGrowth = 1 + BUFFER_FATIGUE * fatigue + BUFFER_INJURY * injury + BUFFER_LOW_MORALE * lowMorale;
  return {
    ...base,
    bufferMs: Math.max(base.bufferMs, Math.ceil(base.bufferMs * bufferGrowth)),
    speedMps: Math.min(base.speedMps, base.speedMps * perf),
    crewWorkRate: Math.min(base.crewWorkRate, base.crewWorkRate * perf),
  };
}
