import { SimTimeMs, type AgentPosition, type EdgeId, type NodeId, type TimedLeg } from "@ember/domain";
import type { RoadEdge, RoadIndex } from "@ember/simulation/model";
import type { HazardModel } from "./hazard.js";
import type { NavConfig, ReservationOracle } from "./types.js";

export interface SearchStart {
  readonly nodeId: NodeId;
  /** Bucket index (time = nowMs + k * bucketMs) at which the agent is at nodeId. */
  readonly k: number;
  /** Legs already implied by the start, e.g. finishing the current edge. */
  readonly prefix: readonly TimedLeg[];
}

type Parent =
  | { readonly kind: "start"; readonly start: SearchStart }
  | { readonly kind: "wait"; readonly fromK: number }
  | {
      readonly kind: "leg";
      readonly fromK: number;
      readonly from: NodeId;
      readonly edge: EdgeId;
      readonly direction: "forward" | "reverse";
    };

export function bucketTravelMs(lengthM: number, config: NavConfig): number {
  const exact = (lengthM / config.speedMps) * 1000;
  return Math.ceil(exact / config.bucketMs) * config.bucketMs;
}

/** Layered time-expanded reachability over the road graph with 5 s buckets. */
export class Reach {
  constructor(
    private readonly layers: readonly Map<NodeId, Parent>[],
    private readonly nowMs: number,
    private readonly config: NavConfig,
  ) {}

  /** Earliest bucket at which any target is reachable; ties break on node id. */
  earliest(targets: ReadonlySet<NodeId>): { nodeId: NodeId; k: number } | null {
    for (let k = 0; k < this.layers.length; k++) {
      const layer = this.layers[k]!;
      const hits = [...layer.keys()].filter((n) => targets.has(n)).sort();
      if (hits.length > 0) return { nodeId: hits[0]!, k };
    }
    return null;
  }

  reachedAt(nodeId: NodeId): number | null {
    for (let k = 0; k < this.layers.length; k++) if (this.layers[k]!.has(nodeId)) return k;
    return null;
  }

  /** Timed legs from the start to (nodeId, k); waits are implicit in depart times. */
  legsTo(nodeId: NodeId, k: number): TimedLeg[] {
    const out: TimedLeg[] = [];
    let node = nodeId;
    let layer = k;
    for (;;) {
      const parent = this.layers[layer]?.get(node);
      if (parent === undefined) throw new Error("path not reachable");
      if (parent.kind === "start") {
        return [...parent.start.prefix, ...out.reverse()];
      }
      if (parent.kind === "wait") {
        layer = parent.fromK;
        continue;
      }
      out.push({
        edgeId: parent.edge,
        direction: parent.direction,
        departMs: SimTimeMs.parse(this.nowMs + parent.fromK * this.config.bucketMs),
        arriveMs: SimTimeMs.parse(this.nowMs + layer * this.config.bucketMs),
      });
      node = parent.from;
      layer = parent.fromK;
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
}

/**
 * Time-expanded search: at each bucket an agent may wait at a node (only where occupancy stays
 * safe) or start a leg whose every crossed cell clears the ensemble constraint. No waiting
 * mid-edge. Bounded by the forecast horizon; reservation availability gates single-capacity edges.
 */
export function timeExpandedSearch(input: SearchInput): Reach {
  const { hm, nowMs, starts, oracle, ban, config } = input;
  const { road } = hm;
  const maxK = Math.floor((hm.horizonEndMs - config.bufferMs - 1 - nowMs) / config.bucketMs);
  const layers: Map<NodeId, Parent>[] = [];
  for (let k = 0; k <= Math.max(0, maxK); k++) layers.push(new Map());
  for (const s of starts) {
    if (s.k > maxK) continue;
    const layer = layers[s.k]!;
    if (!layer.has(s.nodeId)) layer.set(s.nodeId, { kind: "start", start: s });
  }
  for (let k = 0; k <= maxK; k++) {
    const layer = layers[k]!;
    const t = nowMs + k * config.bucketMs;
    for (const node of [...layer.keys()].sort()) {
      if (k + 1 <= maxK) {
        const existing = layers[k + 1]!.get(node);
        // Waiting at a node is preferred to wandering along roads to burn the same time.
        if (existing === undefined || existing.kind === "leg") {
          const refuge = road.refugeNodes.has(node);
          if (refuge || hm.nodeSafeAt(node, t + config.bucketMs)) layers[k + 1]!.set(node, { kind: "wait", fromK: k });
        }
      }
      const options = [...(road.adjacency.get(node) ?? [])].sort((a, b) =>
        a.edgeId !== b.edgeId ? (a.edgeId < b.edgeId ? -1 : 1) : a.direction < b.direction ? -1 : 1,
      );
      for (const adj of options) {
        if (ban?.has(adj.edgeId)) continue;
        const edge: RoadEdge = road.mustEdge(adj.edgeId);
        if (!(t < hm.latestDepartMs(edge, adj.direction))) continue;
        const arriveK = k + bucketTravelMs(edge.length, config) / config.bucketMs;
        if (arriveK > maxK || layers[arriveK]!.has(adj.toNode)) continue;
        if (edge.singleCapacity && !oracle.isFree(edge.id, adj.direction, t, nowMs + arriveK * config.bucketMs)) continue;
        layers[arriveK]!.set(adj.toNode, {
          kind: "leg",
          fromK: k,
          from: node,
          edge: edge.id,
          direction: adj.direction,
        });
      }
    }
  }
  return new Reach(layers, nowMs, config);
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
  private readonly nodes: NodeId[];
  private readonly index = new Map<NodeId, number>();
  private readonly arrive: Int32Array[] = [];
  private readonly how: Int32Array[] = [];
  private readonly options: { edge: RoadEdge; direction: "forward" | "reverse"; to: number; travelK: number }[][] = [];
  readonly maxK: number;

  constructor(
    private readonly hm: HazardModel,
    private readonly nowMs: number,
    oracle: ReservationOracle,
    ban: ReadonlySet<EdgeId> | undefined,
    private readonly config: NavConfig,
  ) {
    const road = hm.road;
    this.nodes = [...road.nodes.keys()].sort();
    this.nodes.forEach((n, i) => this.index.set(n, i));
    this.maxK = Math.floor((hm.horizonEndMs - config.bufferMs - 1 - nowMs) / config.bucketMs);
    for (const n of this.nodes) {
      const list = [...(road.adjacency.get(n) ?? [])]
        .sort((a, b) => (a.edgeId !== b.edgeId ? (a.edgeId < b.edgeId ? -1 : 1) : a.direction < b.direction ? -1 : 1))
        .filter((a) => !ban?.has(a.edgeId))
        .map((a) => {
          const edge = road.mustEdge(a.edgeId);
          return {
            edge,
            direction: a.direction,
            to: this.index.get(a.toNode)!,
            travelK: bucketTravelMs(edge.length, config) / config.bucketMs,
          };
        });
      this.options.push(list);
    }
    for (let k = 0; k <= Math.max(0, this.maxK); k++) {
      this.arrive.push(new Int32Array(this.nodes.length).fill(-1));
      this.how.push(new Int32Array(this.nodes.length).fill(-1));
    }
    for (let k = this.maxK; k >= 0; k--) {
      const t = nowMs + k * config.bucketMs;
      for (let ni = 0; ni < this.nodes.length; ni++) {
        const node = this.nodes[ni]!;
        if (road.refugeNodes.has(node)) {
          this.arrive[k]![ni] = k;
          this.how[k]![ni] = 0;
          continue;
        }
        let best = -1;
        let choice = -1;
        if (k + 1 <= this.maxK && hm.nodeSafeAt(node, t + config.bucketMs)) {
          const a = this.arrive[k + 1]![ni]!;
          if (a >= 0) {
            best = a;
            choice = 1;
          }
        }
        const opts = this.options[ni]!;
        for (let i = 0; i < opts.length; i++) {
          const o = opts[i]!;
          if (!(t < hm.latestDepartMs(o.edge, o.direction))) continue;
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
    const ni = this.index.get(nodeId);
    if (ni === undefined || k < 0 || k > this.maxK) return -1;
    return this.arrive[k]![ni]!;
  }

  /** The timed legs and refuge reached for the earliest return from (nodeId, k). */
  returnFrom(nodeId: NodeId, k: number): { legs: TimedLeg[]; refuge: NodeId } {
    const legs: TimedLeg[] = [];
    let ni = this.index.get(nodeId)!;
    let layer = k;
    for (;;) {
      const how = this.how[layer]![ni]!;
      if (how === 0) return { legs, refuge: this.nodes[ni]! };
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
