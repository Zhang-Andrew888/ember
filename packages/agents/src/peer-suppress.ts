import { scheduledLegs, type AgentId, type MissionPlan, type NodeId } from "@ember/domain";
import { nearestReachableNode, nearestStandoffNode } from "@ember/navigation";
import type { Incident } from "@ember/simulation";
import { RoadIndex, cellCenter, gameHoseRadiusM } from "@ember/simulation/model";

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PendingSuppress {
  readonly cell: number;
  readonly nodeId: string;
  /** Where the crew will hose from, when the plan is known. */
  readonly standoff?: Point;
}

/** Another crew as a nearby crew could see it: where it is and which fire it is hosing from where. */
export interface BrigadePeer {
  readonly agentId: string;
  readonly point: Point | null;
  readonly cell: number | null;
  readonly standoff: Point | null;
  /** Visibly spraying its hose now (not just driving to the fire). */
  readonly spraying: boolean;
}

export interface BrigadePeerPicture {
  readonly suppressCells: ReadonlySet<number>;
  readonly standoffNodes: ReadonlySet<string>;
  readonly peerCountOnCell: (cell: number) => number;
  /** Other crews assigned to this cell (committed or queued this tick). */
  readonly holdersOf: (cell: number) => readonly string[];
  readonly peers?: readonly BrigadePeer[];
}

function inferStandoffNode(road: RoadIndex, cell: number): string | null {
  const reach = gameHoseRadiusM();
  const node = nearestStandoffNode(road, cell, reach) ?? nearestReachableNode(road, cell, Infinity);
  return node ?? null;
}

/**
 * Where a suppress plan's approach ends, i.e. where the crew stands to hose. Off-road approaches
 * may be planned onto the cell itself (the simulator backs the crew off), so points on the cell
 * are skipped in favour of the approach side.
 */
export function planStandoffPoint(road: RoadIndex, plan: MissionPlan): Point | null {
  const cell = plan.work?.kind === "suppress_fire" ? cellCenter(plan.work.gridCellIndex) : null;
  const offCell = (p: Point): boolean => cell === null || Math.hypot(p.x - cell.x, p.y - cell.y) >= 1;
  let point: Point | null = null;
  for (const entry of scheduledLegs(plan)) {
    if (entry.leg.arriveMs > plan.workInterval.startMs) break;
    if (entry.kind === "offroad") {
      if (offCell(entry.leg.start)) point = entry.leg.start;
      if (offCell(entry.leg.end)) point = entry.leg.end;
    } else {
      const edge = road.mustEdge(entry.leg.edgeId);
      const end = road.nodePoint(entry.leg.direction === "forward" ? edge.to : edge.from);
      if (offCell(end)) point = end;
    }
  }
  return point;
}

/** Cells and standoff nodes other crews are heading for (committed or queued this tick). */
export function brigadePeerPicture(
  incident: Incident,
  road: RoadIndex,
  excludeId: AgentId,
  pendingThisStep: ReadonlyMap<AgentId, PendingSuppress>,
): BrigadePeerPicture {
  const suppressCells = new Set<number>();
  const standoffNodes = new Set<string>();
  const holders = new Map<number, string[]>();
  const peers: BrigadePeer[] = [];
  const hold = (cell: number, agentId: string): void => {
    suppressCells.add(cell);
    const list = holders.get(cell) ?? [];
    if (!list.includes(agentId)) list.push(agentId);
    holders.set(cell, list);
  };

  for (const spec of incident.scenario.agents) {
    if (spec.id === excludeId) continue;
    const point = incident.crewPoint(spec.id);
    const queued = pendingThisStep.get(spec.id);
    if (queued !== undefined) {
      hold(queued.cell, spec.id);
      standoffNodes.add(queued.nodeId);
      peers.push({ agentId: spec.id, point, cell: queued.cell, standoff: queued.standoff ?? null, spraying: false });
      continue;
    }
    const plan = incident.activeSuppressPlan(spec.id);
    if (plan !== null && plan.work?.kind === "suppress_fire") {
      const cell = plan.work.gridCellIndex;
      hold(cell, spec.id);
      const node = inferStandoffNode(road, cell);
      if (node !== null) standoffNodes.add(node);
      const standoff = planStandoffPoint(road, plan) ?? point;
      peers.push({ agentId: spec.id, point, cell, standoff, spraying: incident.crewSpraying(spec.id) });
      continue;
    }
    peers.push({ agentId: spec.id, point, cell: null, standoff: null, spraying: false });
  }

  return {
    suppressCells,
    standoffNodes,
    peerCountOnCell: (cell) => holders.get(cell)?.length ?? 0,
    holdersOf: (cell) => holders.get(cell) ?? [],
    peers,
  };
}

/** @deprecated Use brigadePeerPicture */
export function peerSuppressCells(
  incident: Incident,
  excludeId: AgentId,
  pendingThisStep: ReadonlyMap<AgentId, PendingSuppress>,
): ReadonlySet<number> {
  return brigadePeerPicture(incident, new RoadIndex(incident.scenario.map), excludeId, pendingThisStep).suppressCells;
}

export function pendingSuppressFromPlan(road: RoadIndex, gridCellIndex: number, nodeId?: NodeId, plan?: MissionPlan): PendingSuppress {
  const node = nodeId ?? inferStandoffNode(road, gridCellIndex);
  const standoff = plan === undefined ? null : planStandoffPoint(road, plan);
  return {
    cell: gridCellIndex,
    nodeId: node ?? "unknown",
    ...(standoff === null ? {} : { standoff }),
  };
}
