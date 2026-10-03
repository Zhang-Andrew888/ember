import type { Observation, SiteId } from "@ember/domain";
import { GRID_EDGE } from "@ember/knowledge";
import type { SiteKnowledge } from "@ember/navigation";
import type { PublicMap } from "@ember/simulation/model";

/**
 * Incrementally digests an agent's own, append-only observation list: directly observed closed
 * cells, newest site progress, and whether fire evidence changed since the last look.
 */
export class EvidenceTracker {
  readonly closed = new Set<number>();
  private pointer = 0;
  private readonly sites = new Map<SiteId, { completedWork: number; damage: number; destroyed: boolean; at: number }>();
  /** Ids of the latest observations that reported burning or burned cells. */
  private readonly fireObservationIds: string[] = [];

  constructor(private readonly map: PublicMap) {}

  /**
   * Returns true when new evidence of burning or burned cells arrived: the only evidence that
   * changes routes at once. Unburned-only sightings are checked at the normal forecast refresh.
   */
  ingest(observations: readonly Observation[]): boolean {
    let fireChanged = false;
    for (; this.pointer < observations.length; this.pointer++) {
      const obs = observations[this.pointer]!;
      let hasFire = false;
      for (const f of obs.observedFields) {
        if (f.kind === "cell" && f.edgeId === GRID_EDGE) {
          if (f.burnState !== "unburned") {
            hasFire = true;
            this.closed.add(f.cellIndex);
          }
        } else if (f.kind === "site") {
          const prev = this.sites.get(f.siteId);
          if (prev === undefined || prev.at <= obs.observedAt) {
            this.sites.set(f.siteId, {
              completedWork: f.completedWork,
              damage: f.damage,
              destroyed: f.destroyed,
              at: obs.observedAt,
            });
          }
        }
      }
      if (hasFire) fireChanged = true;
      if (hasFire) {
        this.fireObservationIds.push(obs.id);
        if (this.fireObservationIds.length > 3) this.fireObservationIds.shift();
      }
    }
    return fireChanged;
  }

  supportingObservationIds(): string[] {
    return [...this.fireObservationIds];
  }

  siteKnowledge(): SiteKnowledge[] {
    return this.map.sites.map((s) => {
      const seen = this.sites.get(s.id);
      const completed = seen?.completedWork ?? 0;
      return {
        siteId: s.id,
        nodeId: s.nodeId,
        value: s.value,
        requiredWork: s.requiredWork,
        knownCompletedWork: completed,
        knownResolved: (seen?.destroyed ?? false) || completed >= s.requiredWork,
      };
    });
  }
}
