import type { NavConfig } from "@ember/navigation";
import { DEFAULT_NAV_CONFIG } from "@ember/navigation";
import { SIM_DEFAULTS } from "@ember/simulation/model";
// zod: crew attributes are validated at the boundary where profiles are loaded from config.
// The workspace already pins zod 3.24.2 in domain/simulation; agents had no direct dependency.
import { z } from "zod";

/** Crew-internal kinds. The wire role (`AgentRole` in @ember/domain) stays protection_crew | scout. */
export const CREW_KINDS = ["engine", "hand_crew", "scout"] as const;
export type CrewKind = (typeof CREW_KINDS)[number];
export type DomainRole = "protection_crew" | "scout";

const positive = z.number().finite().positive();

export const CrewAttributes = z
  .object({
    /** Travel speed in metres per simulated second. */
    speedMps: positive,
    /** Site work units per simulated second while working. 0 means the kind cannot protect. */
    workRate: z.number().finite().nonnegative(),
    /** Fatigue accumulated per simulated minute of active duty, in [0, 1] units of capacity. */
    fatiguePerMin: z.number().finite().nonnegative(),
    /** Work units the kind can sustain before needing a refuge break. */
    carryingCapacity: positive,
  })
  .strict();
export type CrewAttributes = z.infer<typeof CrewAttributes>;

export interface CrewProfile {
  readonly kind: CrewKind;
  readonly role: DomainRole;
  readonly attributes: CrewAttributes;
}

/**
 * Authored defaults. The simulator currently delivers one speed and work rate to every agent
 * (SIM_DEFAULTS), so these are capability ceilings used for planning, never promises the
 * simulator has to honour: see navConfigFor.
 */
export const CREW_PROFILES: Readonly<Record<CrewKind, CrewProfile>> = {
  engine: {
    kind: "engine",
    role: "protection_crew",
    attributes: { speedMps: 4, workRate: 1, fatiguePerMin: 0.012, carryingCapacity: 120 },
  },
  hand_crew: {
    kind: "hand_crew",
    role: "protection_crew",
    attributes: { speedMps: 3, workRate: 0.8, fatiguePerMin: 0.008, carryingCapacity: 60 },
  },
  scout: {
    kind: "scout",
    role: "scout",
    attributes: { speedMps: 4, workRate: 0, fatiguePerMin: 0.006, carryingCapacity: 10 },
  },
};

export function profileOf(kind: CrewKind): CrewProfile {
  return CREW_PROFILES[kind];
}

export function domainRoleOf(kind: CrewKind): DomainRole {
  return CREW_PROFILES[kind].role;
}

export function defaultKindForRole(role: DomainRole): CrewKind {
  return role === "scout" ? "scout" : "engine";
}

/** Smallest work rate the planner will use, so dwell/duration maths never divides by zero. */
const MIN_PLANNING_WORK_RATE = 0.1;

/**
 * Planning config for a kind. Conservative by construction: speed and work rate are capped at
 * what the simulator delivers (a slower plan is still safe, a faster one is not), and the
 * buffer is never below the base buffer.
 */
export function navConfigFor(kind: CrewKind, base: NavConfig = DEFAULT_NAV_CONFIG): NavConfig {
  const a = CREW_PROFILES[kind].attributes;
  return {
    ...base,
    speedMps: Math.min(a.speedMps, SIM_DEFAULTS.agentSpeedMps, base.speedMps),
    crewWorkRate: Math.max(MIN_PLANNING_WORK_RATE, Math.min(a.workRate, SIM_DEFAULTS.crewWorkRate, base.crewWorkRate)),
    bufferMs: Math.max(base.bufferMs, DEFAULT_NAV_CONFIG.bufferMs),
  };
}
