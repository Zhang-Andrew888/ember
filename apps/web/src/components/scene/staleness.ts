import { formatIncidentClock } from "../../format/time.js";

/**
 * How old information looks. Anything older than STALE_AFTER_MS of
 * SIMULATION time (matches the domain's 30 sim-second rule for cells) is
 * stale: it fades with age down to MIN_OPACITY, is hatched, and its label
 * says how old it is. An old observation must never look current - and a
 * missing age is treated as maximally old, not as fresh.
 */
export const STALE_AFTER_MS = 30_000;
export const FULL_FADE_MS = 150_000;
export const MIN_OPACITY = 0.35;

export interface Freshness {
  readonly stale: boolean;
  /** 1 while fresh, easing down to MIN_OPACITY by FULL_FADE_MS. */
  readonly opacity: number;
  /** "last seen 0:45 ago" (incident clock) or null when fresh. */
  readonly ageLabel: string | null;
}

/** @param ageMs simTimeMs minus the observation's time; null = never observed */
export function freshness(ageMs: number | null, serverStale = false): Freshness {
  if (ageMs === null) {
    return { stale: true, opacity: MIN_OPACITY, ageLabel: "never observed" };
  }
  const age = Math.max(0, ageMs);
  const stale = serverStale || age > STALE_AFTER_MS;
  if (!stale) return { stale: false, opacity: 1, ageLabel: null };
  const t = Math.min(1, Math.max(0, (age - STALE_AFTER_MS) / (FULL_FADE_MS - STALE_AFTER_MS)));
  return {
    stale: true,
    opacity: 1 - (1 - MIN_OPACITY) * t,
    ageLabel: `last seen ${formatIncidentClock(age)} ago`,
  };
}

/** Observation age in sim time; null when it was never observed. */
export function ageOf(simTimeMs: number, observedAtMs: number | null): number | null {
  return observedAtMs === null ? null : Math.max(0, simTimeMs - observedAtMs);
}
