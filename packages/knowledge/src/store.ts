import type { AgentId, Observation, ObservedField, SimTimeMs, SiteId } from "@ember/domain";
import { SimTimeMs as SimTimeMsSchema } from "@ember/domain";
import { hashValue } from "./digest.js";
import type { AgentKnowledgeSnapshot } from "./types.js";

export const STALE_AFTER_MS = 30_000;

export type BurnState = "unburned" | "burning" | "burned";
export type Provenance = "sensor" | "relay";

export interface CellBelief {
  readonly cell: number;
  /** Conservative resolved state: the worst of equally timed conflicting reports. */
  readonly state: BurnState;
  readonly observedAt: SimTimeMs;
  readonly receivedAt: SimTimeMs;
  readonly observationId: string;
  readonly sourceAgentId: AgentId;
  readonly provenance: Provenance;
  readonly conflict: boolean;
}

export interface SiteBelief {
  readonly siteId: SiteId;
  readonly completedWork: number;
  readonly damage: number;
  readonly destroyed: boolean;
  readonly observedAt: SimTimeMs;
  readonly receivedAt: SimTimeMs;
  readonly observationId: string;
  readonly sourceAgentId: AgentId;
}

export type ContradictionKind = "clear_overturned" | "equal_time_conflict";

/** New evidence that disagrees with what this store believed. The cell stays closed afterwards. */
export interface Contradiction {
  readonly cell: number;
  readonly kind: ContradictionKind;
  /** The earlier belief that was overturned (or, for equal-time conflicts, the lower observation id). */
  readonly overturnedObservationId: string;
  readonly byObservationId: string;
  readonly byObservedAt: SimTimeMs;
}

interface Entry {
  readonly observation: Observation;
  readonly provenance: Provenance;
}

const SEVERITY: Record<BurnState, number> = { unburned: 0, burned: 1, burning: 2 };

/**
 * One decision-maker's observation history and the beliefs derived from it.
 * Stores never synchronize implicitly: information crosses only by ingest/ingestRelay.
 */
export class KnowledgeStore {
  readonly agentId: AgentId;
  private readonly entries: Entry[] = [];
  private readonly ids = new Set<string>();
  private readonly cells = new Map<number, CellBelief>();
  private readonly sites = new Map<SiteId, SiteBelief>();
  private readonly closed = new Set<number>();
  private readonly contradictionList: Contradiction[] = [];
  private readonly contradictionKeys = new Set<string>();
  private rev = 0;
  /** Order-independent running digest of every entry, updated in O(1) per ingest. */
  private readonly digest = [0, 0, 0, 0];

  constructor(agentId: AgentId) {
    this.agentId = agentId;
  }

  get revision(): number {
    return this.rev;
  }

  /** Record an observation this decision-maker made or received first-hand. */
  ingest(observation: Observation): boolean {
    return this.add(observation, "sensor");
  }

  /** Record an observation delivered by someone else, keeping its source and observed time. */
  ingestRelay(observation: Observation, deliveredAt: SimTimeMs): boolean {
    return this.add({ ...observation, receivedAt: deliveredAt }, "relay");
  }

  private add(observation: Observation, provenance: Provenance): boolean {
    if (this.ids.has(observation.id)) return false;
    this.ids.add(observation.id);
    this.entries.push({ observation, provenance });
    this.rev += 1;
    const h = hashValue({ p: provenance, o: observation });
    for (let i = 0; i < 4; i++) this.digest[i] = ((this.digest[i] ?? 0) + parseInt(h.slice(i * 8, i * 8 + 8), 16)) >>> 0;
    for (const field of observation.observedFields) this.apply(observation, provenance, field);
    return true;
  }

  private apply(observation: Observation, provenance: Provenance, field: ObservedField): void {
    if (field.kind === "site") {
      const prev = this.sites.get(field.siteId);
      if (prev !== undefined) {
        // Equal observation times resolve by observation id so arrival order never changes the belief.
        if (prev.observedAt > observation.observedAt) return;
        if (prev.observedAt === observation.observedAt && prev.observationId > observation.id) return;
      }
      this.sites.set(field.siteId, {
        siteId: field.siteId,
        completedWork: field.completedWork,
        damage: field.damage,
        destroyed: field.destroyed,
        observedAt: observation.observedAt,
        receivedAt: observation.receivedAt,
        observationId: observation.id,
        sourceAgentId: observation.sourceAgentId,
      });
      return;
    }
    const cell = field.gridCellIndex;
    if (field.burnState !== "unburned") this.closed.add(cell);
    const prev = this.cells.get(cell);
    if (prev !== undefined) this.noteContradiction(prev, observation, field.burnState);
    const next: CellBelief = {
      cell,
      state: field.burnState,
      observedAt: observation.observedAt,
      receivedAt: observation.receivedAt,
      observationId: observation.id,
      sourceAgentId: observation.sourceAgentId,
      provenance,
      conflict: false,
    };
    if (prev === undefined || observation.observedAt > prev.observedAt) {
      this.cells.set(cell, next);
    } else if (observation.observedAt === prev.observedAt) {
      if (field.burnState !== prev.state) {
        const worst = SEVERITY[field.burnState] > SEVERITY[prev.state] ? next : prev;
        this.cells.set(cell, { ...worst, conflict: true });
      } else if (observation.id < prev.observationId) {
        // Same state at the same time: keep the lower observation id so arrival order does not matter.
        this.cells.set(cell, { ...next, conflict: prev.conflict });
      }
    }
  }

  private noteContradiction(prev: CellBelief, observation: Observation, state: BurnState): void {
    let kind: ContradictionKind;
    let overturned: string;
    let by: string;
    if (prev.state === "unburned" && state !== "unburned" && observation.observedAt > prev.observedAt) {
      kind = "clear_overturned";
      overturned = prev.observationId;
      by = observation.id;
    } else if (prev.state !== state && observation.observedAt === prev.observedAt) {
      // Canonical pair order so arrival order never changes the record.
      kind = "equal_time_conflict";
      [overturned, by] = prev.observationId < observation.id ? [prev.observationId, observation.id] : [observation.id, prev.observationId];
    } else {
      return;
    }
    const key = `${kind}:${prev.cell}:${overturned}:${by}`;
    if (this.contradictionKeys.has(key)) return;
    this.contradictionKeys.add(key);
    this.contradictionList.push({ cell: prev.cell, kind, overturnedObservationId: overturned, byObservationId: by, byObservedAt: observation.observedAt });
  }

  /** Every contradiction seen so far, in the order detected. */
  contradictions(): readonly Contradiction[] {
    return this.contradictionList;
  }

  /** Cells whose clear belief was contradicted: a hint that forecasts built on older evidence need rebuilding. */
  contradictedCells(): number[] {
    return [...new Set(this.contradictionList.map((c) => c.cell))].sort((a, b) => a - b);
  }

  /** Beliefs older than the stale limit. They are history, never present truth, and are not erased. */
  staleBeliefs(now: SimTimeMs): { cells: CellBelief[]; sites: SiteBelief[] } {
    return {
      cells: this.cellBeliefs().filter((b) => this.isStale(b, now)),
      sites: this.siteBeliefs().filter((b) => this.isStale(b, now)),
    };
  }

  /** Age of a belief or observation in simulated ms; never negative. */
  ageMs(item: { readonly observedAt: SimTimeMs }, now: SimTimeMs): number {
    return Math.max(0, now - item.observedAt);
  }

  /**
   * True when no field of this observation is the store's current word on its cell or site (an
   * observation with no fields carries nothing, so it counts as superseded too).
   */
  isSuperseded(observation: Observation): boolean {
    for (const f of observation.observedFields) {
      const current = f.kind === "site" ? this.sites.get(f.siteId) : this.cells.get(f.gridCellIndex);
      if (current === undefined || current.observationId === observation.id) return false;
    }
    return true;
  }

  cellBelief(cell: number): CellBelief | undefined {
    return this.cells.get(cell);
  }

  /** All cells with a belief, in ascending cell order. */
  cellBeliefs(): CellBelief[] {
    return [...this.cells.values()].sort((a, b) => a.cell - b.cell);
  }

  siteBelief(siteId: SiteId): SiteBelief | undefined {
    return this.sites.get(siteId);
  }

  siteBeliefs(): SiteBelief[] {
    return [...this.sites.values()].sort((a, b) => (a.siteId < b.siteId ? -1 : 1));
  }

  isStale(belief: { readonly observedAt: SimTimeMs }, now: SimTimeMs): boolean {
    return now - belief.observedAt > STALE_AFTER_MS;
  }

  /**
   * True only for a recent, unconflicted "unburned" sighting. An old clear report is
   * history, never current clearance; unknown cells are not clear either.
   */
  isCurrentlyClear(cell: number, now: SimTimeMs): boolean {
    if (this.closed.has(cell)) return false;
    const belief = this.cells.get(cell);
    if (belief === undefined || belief.conflict || belief.state !== "unburned") return false;
    return !this.isStale(belief, now);
  }

  /** Cells ever seen burning or burned: closed for the rest of the incident. */
  closedCells(): ReadonlySet<number> {
    return this.closed;
  }

  observations(): readonly Observation[] {
    return this.entries.map((e) => e.observation);
  }

  provenanceOf(observationId: string): Provenance | undefined {
    return this.entries.find((e) => e.observation.id === observationId)?.provenance;
  }

  snapshot(asOf: SimTimeMs): AgentKnowledgeSnapshot {
    return {
      agentId: this.agentId,
      revision: this.rev as AgentKnowledgeSnapshot["revision"],
      asOfSimTimeMs: asOf,
      observations: this.observations(),
    };
  }

  /** Hash of everything this store knows. Equal knowledge gives an equal hash. */
  inputHash(): string {
    const hex = this.digest.map((d) => d.toString(16).padStart(8, "0")).join("");
    return `${this.entries.length.toString(16)}-${hex}`;
  }
}

export function toSimTime(ms: number): SimTimeMs {
  return SimTimeMsSchema.parse(Math.round(ms));
}
