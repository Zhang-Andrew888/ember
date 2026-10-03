import type { Observation, SimTimeMs } from "@ember/domain";
import { STALE_AFTER_MS, type KnowledgeStore } from "./store.js";

export interface RelayPolicy {
  /** At most this many observations per relay round. */
  readonly maxItems: number;
  /** Clear-only sightings older than this no longer inform anyone; fire sightings never lapse. */
  readonly maxClearAgeMs: number;
}

export const DEFAULT_RELAY_POLICY: RelayPolicy = { maxItems: 8, maxClearAgeMs: 120_000 };

export interface RelayCandidate {
  /** The original observation: source and observed time are preserved, never refreshed. */
  readonly observation: Observation;
  readonly ageMs: number;
  /** Older than the stale limit: the recipient must weigh its age. */
  readonly stale: boolean;
}

function carriesFire(o: Observation): boolean {
  return o.observedFields.some((f) => f.kind === "cell" && f.burnState !== "unburned");
}

/**
 * Which of a source's observations are worth handing to a recipient. Pure and deterministic:
 * only observations the recipient lacks, still the source's current word on something, and not a
 * lapsed clear-only sighting. Fire first (a closure is permanent), then newest, then id.
 * Only observations travel: never the source's forecast, plan or any world parameter.
 */
export function selectRelay(
  source: KnowledgeStore,
  recipientHas: ReadonlySet<string>,
  now: SimTimeMs,
  policy: RelayPolicy = DEFAULT_RELAY_POLICY,
): RelayCandidate[] {
  const out: (RelayCandidate & { fire: boolean })[] = [];
  for (const observation of source.observations()) {
    if (recipientHas.has(observation.id) || source.isSuperseded(observation)) continue;
    const ageMs = source.ageMs(observation, now);
    const fire = carriesFire(observation);
    const clearOnly = !fire && observation.observedFields.every((f) => f.kind === "cell");
    if (clearOnly && ageMs > policy.maxClearAgeMs) continue;
    out.push({ observation, ageMs, stale: ageMs > STALE_AFTER_MS, fire });
  }
  out.sort((a, b) => {
    if (a.fire !== b.fire) return a.fire ? -1 : 1;
    if (a.observation.observedAt !== b.observation.observedAt) return b.observation.observedAt - a.observation.observedAt;
    return a.observation.id < b.observation.id ? -1 : a.observation.id > b.observation.id ? 1 : 0;
  });
  return out.slice(0, policy.maxItems).map(({ observation, ageMs, stale }) => ({ observation, ageMs, stale }));
}
