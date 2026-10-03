import type { EdgeId, NodeId } from "@ember/domain";
import { earliestIgnitionMs } from "@ember/forecast";
import type { ForecastEnsemble, ForecastMember } from "@ember/forecast";
import { SIM_DEFAULTS, cellIndexOf, type RoadEdge, type RoadIndex } from "@ember/simulation/model";
import type { NavConfig } from "./types.js";

/**
 * Safety constraints for road cells and nodes: a place occupied until time t is safe only if
 * t + buffer is before the earliest ignition across every retained member. Directly observed
 * closures fail immediately. Forecast support ends at the horizon.
 */
export class HazardModel {
  readonly horizonEndMs: number;
  private readonly earliest: Float64Array;
  private readonly departForward = new Map<EdgeId, number>();
  private readonly departReverse = new Map<EdgeId, number>();
  private safeUntilTable: Float64Array | null = null;

  constructor(
    readonly road: RoadIndex,
    ensemble: ForecastEnsemble,
    readonly closed: ReadonlySet<number>,
    readonly config: NavConfig,
    members: readonly ForecastMember[] = ensemble.members,
  ) {
    this.horizonEndMs = ensemble.horizonEndMs;
    this.earliest = members === ensemble.members ? earliestIgnitionMs(ensemble) : minIgnition(members);
  }

  cellIgnMs(cell: number): number {
    return this.closed.has(cell) ? -Infinity : this.earliest[cell]!;
  }

  /** Latest time this place may still be occupied: occupancy must end before this. */
  nodeSafeUntilMs(nodeId: NodeId): number {
    if (this.road.refugeNodes.has(nodeId)) return Infinity;
    const p = this.road.nodePoint(nodeId);
    const cell = cellIndexOf(p.x, p.y);
    if (cell === null) return -Infinity;
    return this.cellIgnMs(cell) - this.config.bufferMs;
  }

  /** Occupancy may end at endMs at this node iff endMs is strictly before the safe-until bound. */
  nodeSafeAt(nodeId: NodeId, endMs: number): boolean {
    return endMs < this.nodeSafeUntilMs(nodeId) && endMs + this.config.bufferMs < this.horizonEndMs;
  }

  /**
   * Departing the start of `edge` in `direction` at time t0 is safe iff t0 < this bound,
   * checked against every crossed road cell's exit time.
   */
  latestDepartMs(edge: RoadEdge, direction: "forward" | "reverse"): number {
    const cache = direction === "forward" ? this.departForward : this.departReverse;
    const hit = cache.get(edge.id);
    if (hit !== undefined) return hit;
    const from = direction === "forward" ? 0 : edge.length;
    const to = direction === "forward" ? edge.length : 0;
    const bound = this.partialLatestMs(edge, from, to);
    cache.set(edge.id, bound);
    return bound;
  }

  /** nodeSafeUntilMs for every node of `nodes`, in that order; computed once per model. */
  nodeSafeUntilTable(nodes: readonly NodeId[]): Float64Array {
    if (this.safeUntilTable === null) {
      this.safeUntilTable = Float64Array.from(nodes, (n) => this.nodeSafeUntilMs(n));
    }
    return this.safeUntilTable;
  }

  /**
   * Agent is at distance `fromDist` at time t; moving toward `toDist`. Safe iff t is strictly
   * below the returned bound. The cell the agent is standing in counts.
   */
  partialLatestMs(edge: RoadEdge, fromDist: number, toDist: number): number {
    const speed = this.config.speedMps;
    const forward = toDist >= fromDist;
    const lo = Math.min(fromDist, toDist);
    const hi = Math.max(fromDist, toDist);
    let bound = Infinity;
    for (const c of edge.cells) {
      if (c.endDist < lo || c.startDist > hi) continue;
      const exitBoundary = forward ? Math.min(c.endDist, toDist) : Math.max(c.startDist, toDist);
      const travel = forward ? Math.max(0, exitBoundary - fromDist) : Math.max(0, fromDist - exitBoundary);
      const limit = this.cellIgnMs(c.cell) - this.config.bufferMs - (travel / speed) * 1000;
      if (limit < bound) bound = limit;
    }
    return bound;
  }

  edgeId(edge: RoadEdge): EdgeId {
    return edge.id;
  }
}

function minIgnition(members: readonly ForecastMember[]): Float64Array {
  const n = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.gridSize;
  const out = new Float64Array(n).fill(Infinity);
  for (const m of members) {
    for (let i = 0; i < n; i++) {
      const v = m.ignitionMs[i]!;
      if (v < out[i]!) out[i] = v;
    }
  }
  return out;
}
