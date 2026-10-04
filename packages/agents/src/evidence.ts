import type { Observation, SiteId } from "@ember/domain";
import type { SiteKnowledge } from "@ember/navigation";
import { SIM_DEFAULTS, type PublicMap } from "@ember/simulation/model";

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
  /** Newest burn sighting per cell (observation time wins over ingest order). */
  private readonly cellBurnLatest = new Map<number, { at: number; state: "unburned" | "burning" | "burned" }>();

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
        if (f.kind === "cell") {
          if (f.burnState !== "unburned") {
            hasFire = true;
            this.closed.add(f.gridCellIndex);
          }
          this.noteCellBurn(f.gridCellIndex, f.burnState, obs.observedAt);
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

  /**
   * Grid cells the crew should treat as actively burning for containment planning.
   * Drops cells with a newer burned/unburned sighting, and cells whose last burning sighting
   * is older than the simulated burn duration (the cell would have burned out by now).
   */
  knownBurningCells(nowMs: number): readonly number[] {
    const horizon = SIM_DEFAULTS.cellBurnMs;
    const out: number[] = [];
    for (const [cell, seen] of this.cellBurnLatest) {
      if (seen.state !== "burning") continue;
      if (nowMs > seen.at + horizon) continue;
      out.push(cell);
    }
    return out;
  }

  /**
   * Initial fire cells from the public briefing, minus any the crew has since seen fully burned out.
   * Used for suppression planning before direct sightings arrive.
   */
  briefingFireCells(nowMs: number): readonly number[] {
    const horizon = SIM_DEFAULTS.cellBurnMs;
    const out: number[] = [];
    for (const cell of this.map.initialFireCells) {
      const seen = this.cellBurnLatest.get(cell);
      if (seen?.state === "burned") continue;
      if (seen?.state === "burning" && nowMs > seen.at + horizon) continue;
      if (seen === undefined || seen.state === "burning") out.push(cell);
    }
    return out;
  }

  /** True when this crew's latest sighting of the cell showed it not burning. */
  seenNotBurning(cell: number): boolean {
    const seen = this.cellBurnLatest.get(cell);
    return seen !== undefined && seen.state !== "burning";
  }

  private noteCellBurn(cell: number, state: "unburned" | "burning" | "burned", at: number): void {
    const prev = this.cellBurnLatest.get(cell);
    if (prev !== undefined && at < prev.at) return;
    this.cellBurnLatest.set(cell, { at, state });
  }

  /** Stop planning new containment on a cell after a crew finished or abandoned that assignment. */
  retireContainmentCell(cell: number, at: number): void {
    this.noteCellBurn(cell, "burned", at);
  }

  /** Known damage or loss: structure work is warranted even without a fresh burn sighting. */
  siteNeedsProtection(siteId: SiteId): boolean {
    const seen = this.sites.get(siteId);
    if (seen === undefined) return false;
    if (seen.destroyed) return false;
    return seen.damage > 0;
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
