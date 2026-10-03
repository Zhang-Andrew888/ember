import type { EdgeId, NodeId } from "@ember/domain";
import type { RoadEdge, RoadIndex } from "@ember/simulation/model";
import type { HazardModel } from "./hazard.js";
import { bucketTravelMs } from "./travel.js";
import type { NavConfig } from "./types.js";

/** One directed way to leave a node, in the planner's stable (edge id, direction) order. */
export interface GraphOption {
  readonly edge: RoadEdge;
  readonly direction: "forward" | "reverse";
  /** Ordinal of the node this option arrives at. */
  readonly to: number;
}

/**
 * The road graph in the form the searches iterate: nodes in id order, each node's outgoing options
 * in (edge id, direction) order. That order is what makes searches deterministic. A road never
 * changes after it is built, so this is derived once per RoadIndex.
 */
export class StaticGraph {
  readonly nodes: readonly NodeId[];
  readonly index = new Map<NodeId, number>();
  readonly options: readonly (readonly GraphOption[])[];
  readonly refuge: readonly boolean[];

  constructor(road: RoadIndex) {
    this.nodes = [...road.nodes.keys()].sort();
    this.nodes.forEach((n, i) => this.index.set(n, i));
    this.options = this.nodes.map((n) =>
      [...(road.adjacency.get(n) ?? [])]
        .sort((a, b) => (a.edgeId !== b.edgeId ? (a.edgeId < b.edgeId ? -1 : 1) : a.direction < b.direction ? -1 : 1))
        .map((a) => ({ edge: road.mustEdge(a.edgeId), direction: a.direction, to: this.index.get(a.toNode)! })),
    );
    this.refuge = this.nodes.map((n) => road.refugeNodes.has(n));
  }

  get nodeCount(): number {
    return this.nodes.length;
  }
}

const graphs = new WeakMap<RoadIndex, StaticGraph>();

export function graphOf(road: RoadIndex): StaticGraph {
  let g = graphs.get(road);
  if (g === undefined) {
    g = new StaticGraph(road);
    graphs.set(road, g);
  }
  return g;
}

/** A graph option bound to one hazard model and config: its travel time and last safe departure. */
export interface PlannedOption extends GraphOption {
  readonly travelK: number;
  /** Departing the start of the edge strictly before this time is safe (HazardModel.latestDepartMs). */
  readonly latestDepartMs: number;
}

const optionCache = new WeakMap<HazardModel, { readonly config: NavConfig; readonly lists: PlannedOption[][] }>();

/**
 * Every node's usable options for one hazard model, minus banned edges. The unbanned lists are
 * built once per model (a model never changes), so a search that only differs by its ban set pays
 * just a filter. Returned lists are shared and must not be mutated.
 */
export function plannedOptions(
  graph: StaticGraph,
  hm: HazardModel,
  ban: ReadonlySet<EdgeId> | undefined,
  config: NavConfig,
): readonly (readonly PlannedOption[])[] {
  let cached = optionCache.get(hm);
  if (cached === undefined || cached.config !== config) {
    cached = {
      config,
      lists: graph.options.map((list) =>
        list.map((o) => ({
          ...o,
          travelK: bucketTravelMs(o.edge.length, config) / config.bucketMs,
          latestDepartMs: hm.latestDepartMs(o.edge, o.direction),
        })),
      ),
    };
    optionCache.set(hm, cached);
  }
  if (ban === undefined || ban.size === 0) return cached.lists;
  return cached.lists.map((list) => list.filter((o) => !ban.has(o.edge.id)));
}

/** True when some node in `goals` is connected to a start by the given options, ignoring time and fire. */
export function connected(
  options: readonly (readonly PlannedOption[])[],
  startOrdinals: readonly number[],
  goals: readonly number[],
): boolean {
  const seen = new Uint8Array(options.length);
  const stack: number[] = [];
  for (const s of startOrdinals) {
    if (seen[s] === 0) {
      seen[s] = 1;
      stack.push(s);
    }
  }
  while (stack.length > 0) {
    const ni = stack.pop()!;
    for (const o of options[ni]!) {
      if (seen[o.to] === 0) {
        seen[o.to] = 1;
        stack.push(o.to);
      }
    }
  }
  return goals.some((o) => seen[o] === 1);
}
