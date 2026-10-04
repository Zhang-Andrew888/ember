import { SimTimeMs, type AgentPosition, type EdgeId, type NodeId, type TimedLeg } from "@ember/domain";
import type { RoadIndex } from "@ember/simulation/model";
import { connected, graphOf, plannedOptions, type PlannedOption, type StaticGraph } from "./graph.js";
import type { HazardModel } from "./hazard.js";
import { bucketTravelMs } from "./travel.js";
import type { NavConfig, ReservationOracle } from "./types.js";

export { bucketTravelMs };

export interface SearchStart {
  readonly nodeId: NodeId;
  /** Bucket index (time = nowMs + k * bucketMs) at which the agent is at nodeId. */
  readonly k: number;
  /** Legs already implied by the start, e.g. finishing the current edge. */
  readonly prefix: readonly TimedLeg[];
}

/** How a (bucket, node) cell of the search was first reached. */
const ABSENT = 0;
const START = 1;
const WAIT = 2;
const LEG = 3;

/**
 * Layered time-expanded reachability over the road graph with 5 s buckets. Layer k, node n lives at
 * flat index k * nodeCount + n. `via` is the start index for a start and the option index (in the
 * departure node's option list) for a leg.
 */
export class Reach {
  constructor(
    private readonly graph: StaticGraph,
    private readonly options: readonly (readonly PlannedOption[])[],
    private readonly starts: readonly SearchStart[],
    private readonly layerCount: number,
    private readonly kind: Uint8Array,
    private readonly fromK: Int32Array,
    private readonly from: Int32Array,
    private readonly via: Int32Array,
    private readonly nowMs: number,
    private readonly config: NavConfig,
  ) {}

  /** Earliest bucket at which any target is reachable; ties break on node id. */
  earliest(targets: ReadonlySet<NodeId>): { nodeId: NodeId; k: number } | null {
    const n = this.graph.nodeCount;
    const ords: number[] = [];
    for (const t of targets) {
      const o = this.graph.index.get(t);
      if (o !== undefined) ords.push(o);
    }
    for (let k = 0; k < this.layerCount; k++) {
      let hit: NodeId | null = null;
      for (const o of ords) {
        if (this.kind[k * n + o] === ABSENT) continue;
        const id = this.graph.nodes[o]!;
        if (hit === null || id < hit) hit = id;
      }
      if (hit !== null) return { nodeId: hit, k };
    }
    return null;
  }

  reachedAt(nodeId: NodeId): number | null {
    const o = this.graph.index.get(nodeId);
    if (o === undefined) return null;
    for (let k = 0; k < this.layerCount; k++) if (this.kind[k * this.graph.nodeCount + o] !== ABSENT) return k;
    return null;
  }

  /** Timed legs from the start to (nodeId, k); waits are implicit in depart times. */
  legsTo(nodeId: NodeId, k: number): TimedLeg[] {
    const n = this.graph.nodeCount;
    const out: TimedLeg[] = [];
    let node = this.graph.index.get(nodeId);
    let layer = k;
    for (;;) {
      if (node === undefined || layer < 0 || layer >= this.layerCount) throw new Error("path not reachable");
      const at = layer * n + node;
      const kind = this.kind[at]!;
      if (kind === ABSENT) throw new Error("path not reachable");
      if (kind === START) return [...this.starts[this.via[at]!]!.prefix, ...out.reverse()];
      if (kind === WAIT) {
        layer = this.fromK[at]!;
        continue;
      }
      const prev = this.from[at]!;
      const opt = this.options[prev]![this.via[at]!]!;
      out.push({
        edgeId: opt.edge.id,
        direction: opt.direction,
        departMs: SimTimeMs.parse(this.nowMs + this.fromK[at]! * this.config.bucketMs),
        arriveMs: SimTimeMs.parse(this.nowMs + layer * this.config.bucketMs),
      });
      node = prev;
      layer = this.fromK[at]!;
    }
  }
}

export interface SearchInput {
  readonly hm: HazardModel;
  readonly nowMs: number;
  readonly starts: readonly SearchStart[];
  readonly oracle: ReservationOracle;
  readonly ban?: ReadonlySet<EdgeId> | undefined;
  readonly config: NavConfig;
  /**
   * Stop expanding once a layer contains any of these nodes. The earliest arrival at them, and the
   * path to it, are identical to a full search; later layers are simply left empty.
   */
  readonly stopAt?: ReadonlySet<NodeId> | undefined;
}

/**
 * Time-expanded search: at each bucket an agent may wait at a node (only where occupancy stays
 * safe) or start a leg whose every crossed cell clears the ensemble constraint. No waiting
 * mid-edge. Bounded by the forecast horizon; reservation availability gates single-capacity edges.
 */
export function timeExpandedSearch(input: SearchInput): Reach {
  const { hm, nowMs, starts, oracle, ban, config, stopAt } = input;
  const graph = graphOf(hm.road);
  const n = graph.nodeCount;
  const options = plannedOptions(graph, hm, ban, config);
  const safeUntil = hm.nodeSafeUntilTable(graph.nodes);
  const maxK = Math.floor((hm.horizonEndMs - config.bufferMs - 1 - nowMs) / config.bucketMs);
  const stopOrds: number[] = [];
  for (const t of stopAt ?? []) {
    const o = graph.index.get(t);
    if (o !== undefined) stopOrds.push(o);
  }
  // Time and fire only remove ways to reach a node, so a goal cut off on the bare graph (typically by
  // banning a bridge edge) is unreachable without paying for the layered search.
  const startOrds = starts.flatMap((s) => graph.index.get(s.nodeId) ?? []);
  if (stopOrds.length > 0 && !connected(options, startOrds, stopOrds)) {
    const none = new Uint8Array(0);
    const noneK = new Int32Array(0);
    return new Reach(graph, options, starts, 0, none, noneK, noneK, noneK, nowMs, config);
  }
  const layerCount = Math.max(0, maxK) + 1;
  const kind = new Uint8Array(layerCount * n);
  const fromK = new Int32Array(layerCount * n);
  const from = new Int32Array(layerCount * n);
  const via = new Int32Array(layerCount * n);
  const reach = new Reach(graph, options, starts, layerCount, kind, fromK, from, via, nowMs, config);

  starts.forEach((s, i) => {
    const o = graph.index.get(s.nodeId);
    if (s.k > maxK || o === undefined || kind[s.k * n + o] !== ABSENT) return;
    kind[s.k * n + o] = START;
    via[s.k * n + o] = i;
  });
  const present = new Int32Array(n);

  for (let k = 0; k <= maxK; k++) {
    const base = k * n;
    // Layer k is final here: waits and legs only ever write to later layers.
    if (stopOrds.some((o) => kind[base + o] !== ABSENT)) break;
    const t = nowMs + k * config.bucketMs;
    let count = 0;
    for (let ni = 0; ni < n; ni++) if (kind[base + ni] !== ABSENT) present[count++] = ni;
    for (let p = 0; p < count; p++) {
      const ni = present[p]!;
      if (k + 1 <= maxK) {
        const next = base + n + ni;
        // Waiting at a node is preferred to wandering along roads to burn the same time.
        if (kind[next] === ABSENT || kind[next] === LEG) {
          const end = t + config.bucketMs;
          if (graph.refuge[ni] === true || (end < safeUntil[ni]! && end + config.bufferMs < hm.horizonEndMs)) {
            kind[next] = WAIT;
            fromK[next] = k;
          }
        }
      }
      const list = options[ni]!;
      for (let i = 0; i < list.length; i++) {
        const o = list[i]!;
        if (!(t < o.latestDepartMs)) continue;
        const arriveK = k + o.travelK;
        if (arriveK > maxK) continue;
        const at = arriveK * n + o.to;
        if (kind[at] !== ABSENT) continue;
        if (o.edge.singleCapacity && !oracle.isFree(o.edge.id, o.direction, t, nowMs + arriveK * config.bucketMs)) continue;
        kind[at] = LEG;
        fromK[at] = k;
        from[at] = ni;
        via[at] = i;
      }
    }
  }
  return reach;
}

/**
 * Starting states from the agent's actual position. Mid-edge, both finishing the edge and
 * reversing (with the turnaround delay) are offered, each only if its remaining cells are safe.
 */
export function startsFromPosition(
  hm: HazardModel,
  position: AgentPosition,
  nowMs: number,
  config: NavConfig,
): SearchStart[] {
  if (position.kind === "node") return [{ nodeId: position.nodeId, k: 0, prefix: [] }];
  if (position.kind === "offroad") return [];
  const road: RoadIndex = hm.road;
  const edge = road.mustEdge(position.edgeId);
  const dist = position.distanceAlongPolyline;
  const out: SearchStart[] = [];
  const consider = (direction: "forward" | "reverse", delayMs: number): void => {
    const toDist = direction === "forward" ? edge.length : 0;
    const remaining = Math.abs(toDist - dist);
    const t0 = nowMs + delayMs;
    if (!(t0 < hm.partialLatestMs(edge, dist, toDist))) return;
    const travel = delayMs + (remaining / config.speedMps) * 1000;
    const k = Math.ceil(travel / config.bucketMs);
    out.push({
      nodeId: direction === "forward" ? edge.to : edge.from,
      k,
      prefix: [
        {
          edgeId: edge.id,
          direction,
          departMs: SimTimeMs.parse(nowMs),
          arriveMs: SimTimeMs.parse(nowMs + k * config.bucketMs),
        },
      ],
    });
  };
  const turning = position.turnaroundTimeRemaining;
  consider(position.direction, turning);
  consider(position.direction === "forward" ? "reverse" : "forward", config.turnaroundMs);
  return out;
}

/**
 * Backward table: for every (node, bucket) the earliest bucket at which a refuge can be reached
 * safely, or -1. One pass answers the return search for every work interval of a mission.
 */
export class ReturnTable {
  private readonly graph: StaticGraph;
  private readonly arrive: Int32Array[] = [];
  private readonly how: Int32Array[] = [];
  private readonly options: readonly (readonly PlannedOption[])[];
  readonly maxK: number;

  constructor(
    hm: HazardModel,
    private readonly nowMs: number,
    oracle: ReservationOracle,
    ban: ReadonlySet<EdgeId> | undefined,
    private readonly config: NavConfig,
  ) {
    this.graph = graphOf(hm.road);
    const nodeCount = this.graph.nodeCount;
    this.options = plannedOptions(this.graph, hm, ban, config);
    const safeUntil = hm.nodeSafeUntilTable(this.graph.nodes);
    this.maxK = Math.floor((hm.horizonEndMs - config.bufferMs - 1 - nowMs) / config.bucketMs);
    for (let k = 0; k <= Math.max(0, this.maxK); k++) {
      this.arrive.push(new Int32Array(nodeCount).fill(-1));
      this.how.push(new Int32Array(nodeCount).fill(-1));
    }
    for (let k = this.maxK; k >= 0; k--) {
      const t = nowMs + k * config.bucketMs;
      const end = t + config.bucketMs;
      for (let ni = 0; ni < nodeCount; ni++) {
        if (this.graph.refuge[ni] === true) {
          this.arrive[k]![ni] = k;
          this.how[k]![ni] = 0;
          continue;
        }
        let best = -1;
        let choice = -1;
        if (k + 1 <= this.maxK && end < safeUntil[ni]! && end + config.bufferMs < hm.horizonEndMs) {
          const a = this.arrive[k + 1]![ni]!;
          if (a >= 0) {
            best = a;
            choice = 1;
          }
        }
        const opts = this.options[ni]!;
        for (let i = 0; i < opts.length; i++) {
          const o = opts[i]!;
          if (!(t < o.latestDepartMs)) continue;
          const kk = k + o.travelK;
          if (kk > this.maxK) continue;
          if (o.edge.singleCapacity && !oracle.isFree(o.edge.id, o.direction, t, nowMs + kk * config.bucketMs)) continue;
          const a = this.arrive[kk]![o.to]!;
          if (a >= 0 && (best < 0 || a < best)) {
            best = a;
            choice = 2 + i;
          }
        }
        this.arrive[k]![ni] = best;
        this.how[k]![ni] = choice;
      }
    }
  }

  /** Earliest bucket of refuge arrival from (nodeId, k), or -1 if no safe return exists. */
  arrival(nodeId: NodeId, k: number): number {
    const ni = this.graph.index.get(nodeId);
    if (ni === undefined || k < 0 || k > this.maxK) return -1;
    return this.arrive[k]![ni]!;
  }

  /** The timed legs and refuge reached for the earliest return from (nodeId, k). */
  returnFrom(nodeId: NodeId, k: number): { legs: TimedLeg[]; refuge: NodeId } {
    const legs: TimedLeg[] = [];
    let ni = this.graph.index.get(nodeId)!;
    let layer = k;
    for (;;) {
      const how = this.how[layer]![ni]!;
      if (how === 0) return { legs, refuge: this.graph.nodes[ni]! };
      if (how === 1) {
        layer += 1;
        continue;
      }
      if (how < 0) throw new Error("no return from here");
      const o = this.options[ni]![how - 2]!;
      legs.push({
        edgeId: o.edge.id,
        direction: o.direction,
        departMs: SimTimeMs.parse(this.nowMs + layer * this.config.bucketMs),
        arriveMs: SimTimeMs.parse(this.nowMs + (layer + o.travelK) * this.config.bucketMs),
      });
      layer += o.travelK;
      ni = o.to;
    }
  }
}
