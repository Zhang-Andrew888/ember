import type { MissionPlan, OffroadTimedLeg, TimedLeg } from "./records.js";

export type ScheduledLeg =
  | { readonly kind: "road"; readonly leg: TimedLeg; readonly roadIndex: number }
  | { readonly kind: "offroad"; readonly leg: OffroadTimedLeg; readonly offroadIndex: number };

/** Road and off-road legs merged in departure-time order for simulation and certification. */
export function scheduledLegs(plan: MissionPlan): ScheduledLeg[] {
  const merged: Array<ScheduledLeg & { departMs: number }> = [];
  plan.timedLegs.forEach((leg, roadIndex) => {
    merged.push({ kind: "road", leg, roadIndex, departMs: leg.departMs });
  });
  for (const [offroadIndex, leg] of (plan.offroadLegs ?? []).entries()) {
    merged.push({ kind: "offroad", leg, offroadIndex, departMs: leg.departMs });
  }
  merged.sort((a, b) => a.departMs - b.departMs || (a.kind === b.kind ? 0 : a.kind === "road" ? -1 : 1));
  return merged;
}

export function scheduledLegCount(plan: MissionPlan): number {
  return plan.timedLegs.length + (plan.offroadLegs?.length ?? 0);
}

export function approachLegCount(plan: MissionPlan): number {
  const hasWork = plan.workInterval.endMs > plan.workInterval.startMs;
  if (!hasWork) return scheduledLegCount(plan);
  return scheduledLegs(plan).filter((entry) => entry.leg.departMs < plan.workInterval.startMs).length;
}
