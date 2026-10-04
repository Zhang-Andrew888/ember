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
  /** Full age phrase for inspection panels and label tooltips; null when fresh. */
  readonly detailAgeLabel: string | null;
}

/** @param ageMs simTimeMs minus the observation's time; null = never observed */
export function freshness(ageMs: number | null, serverStale = false): Freshness {
  if (ageMs === null) {
    return { stale: true, opacity: MIN_OPACITY, detailAgeLabel: "never observed" };
  }
  const age = Math.max(0, ageMs);
  const stale = serverStale || age > STALE_AFTER_MS;
  if (!stale) return { stale: false, opacity: 1, detailAgeLabel: null };
  const t = Math.min(1, Math.max(0, (age - STALE_AFTER_MS) / (FULL_FADE_MS - STALE_AFTER_MS)));
  return {
    stale: true,
    opacity: 1 - (1 - MIN_OPACITY) * t,
    detailAgeLabel: `last seen ${formatIncidentClock(age)} ago`,
  };
}

/** Tooltip on stale map labels: exact incident time plus age, without cluttering the label text. */
export function staleObservationTooltip(simTimeMs: number, ageMs: number | null, serverStale = false): string | undefined {
  const fresh = freshness(ageMs, serverStale);
  if (!fresh.stale) return undefined;
  if (ageMs === null) return "Never observed";
  const observedAt = simTimeMs - ageMs;
  return `Last observed at ${formatIncidentClock(observedAt)} incident time (${fresh.detailAgeLabel})`;
}

/** Inspection readout for a selected fire cell or similar observed item. */
export function formatObservationInspection(lastObservedAt: number, simTimeMs: number, stale: boolean): string {
  const ageMs = Math.max(0, simTimeMs - lastObservedAt);
  const clock = formatIncidentClock(lastObservedAt);
  const ageSec = Math.round(ageMs / 1000);
  return stale
    ? `${clock} incident time (${ageSec}s ago), stale`
    : `${clock} incident time (${ageSec}s ago)`;
}

/** Observation age in sim time; null when it was never observed. */
export function ageOf(simTimeMs: number, observedAtMs: number | null): number | null {
  return observedAtMs === null ? null : Math.max(0, simTimeMs - observedAtMs);
}
