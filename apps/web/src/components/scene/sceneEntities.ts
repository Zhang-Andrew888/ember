import type { CoordinatorAgentView, CoordinatorView } from "@ember/domain";
import type { ScenarioMap, SceneNode } from "../../map/scenarioMap.js";
import {
  resolveAgentPosition,
  resolveGridCellPosition,
  resolveNodePosition,
  resolveEdgeHeading,
  type SceneHeading,
  type SceneVector,
} from "../../map/positions.js";
import { buildForecastLayer, buildRouteLines, type ForecastLayer, type RouteLine } from "./sceneLayers.js";
import { siteProtectionStatus, type SiteProtectionStatus } from "../../format/reports.js";

export interface AgentMarker {
  readonly id: string;
  readonly callsign: string;
  readonly role: CoordinatorAgentView["role"];
  readonly state: CoordinatorAgentView["state"];
  readonly position: SceneVector;
  readonly heading: SceneHeading | null;
}

export interface SiteMarker {
  readonly id: string;
  readonly name: string;
  readonly position: SceneVector;
  readonly protectionStatus: SiteProtectionStatus;
  readonly damage: number | null;
  readonly stale: boolean;
}

export interface FireCellMarker {
  readonly key: string;
  readonly gridCellIndex: number;
  readonly position: SceneVector;
  readonly burnState: "unburned" | "burning" | "burned";
  readonly stale: boolean;
  /** simTimeMs the cell was last observed at - for inspection timestamps (docs/FRONTEND.md). */
  readonly lastObservedAt: number;
}

export interface SceneEntities {
  readonly agents: AgentMarker[];
  readonly sites: SiteMarker[];
  readonly fireCells: FireCellMarker[];
  /** Reportable plans (route emphasis); selection is applied at render time. */
  readonly routes: RouteLine[];
  /** Coordinator forecast envelope; null before the first build. */
  readonly forecast: ForecastLayer | null;
}

/** Every refuge node the local scenario map knows about (public, static). */
export function listRefugeNodes(map: ScenarioMap): SceneNode[] {
  return [...map.nodes.values()].filter((node) => node.kind === "refuge");
}

/**
 * Resolves a CoordinatorView snapshot against the local scene geometry.
 * Entities whose position can't be resolved (an id missing from the
 * placeholder map) are skipped rather than rendered at a fallback origin -
 * a gap here is a map/data problem, not something to paper over visually.
 */
export function buildSceneEntities(view: CoordinatorView, map: ScenarioMap): SceneEntities {
  const agents = fanOutAtNodes(resolveAgents(view, map), view, map);

  const sites: SiteMarker[] = [];
  for (const site of view.sites) {
    const position = resolveNodePosition(map, site.nodeId);
    if (!position) continue;
    sites.push({
      id: site.id,
      name: site.name,
      position,
      protectionStatus: siteProtectionStatus(site),
      damage: site.observedDamage,
      stale: site.stale,
    });
  }

  const fireCells = resolveFireCells(view, map);

  return {
    agents,
    sites,
    fireCells,
    routes: buildRouteLines(view, map, null),
    forecast: buildForecastLayer(view, map),
  };
}

function resolveAgents(view: CoordinatorView, map: ScenarioMap): AgentMarker[] {
  const agents: AgentMarker[] = [];
  for (const agent of view.agents) {
    const position = resolveAgentPosition(map, agent.position);
    if (!position) continue;
    const heading =
      agent.position.kind === "edge"
        ? resolveEdgeHeading(
            map,
            agent.position.edgeId,
            agent.position.direction,
            agent.position.distanceAlongPolyline,
          )
        : null;
    agents.push({
      id: agent.id,
      callsign: agent.callsign,
      role: agent.role,
      state: agent.state,
      position,
      heading,
    });
  }
  return agents;
}

/** Distance from a site/refuge node's centre at which agents standing there are drawn (clears the model). */
export const NODE_CLEARANCE = 92;
/** Spacing used when several agents share an ordinary junction. */
export const JUNCTION_SPREAD = 30;

/**
 * Agents standing at a node would sit exactly on top of a site/refuge model
 * (or on each other). Fan them out south of the node (toward the viewer) so
 * every marker stays visible; positions are display-only and never feed back
 * into anything else.
 */
export function fanOutAtNodes(agents: AgentMarker[], view: CoordinatorView, map: ScenarioMap): AgentMarker[] {
  const byNode = new Map<string, number[]>();
  for (const agent of view.agents) {
    if (agent.position.kind !== "node") continue;
    const resolvedIndex = agents.findIndex((marker) => marker.id === agent.id);
    if (resolvedIndex < 0) continue;
    const list = byNode.get(agent.position.nodeId) ?? [];
    list.push(resolvedIndex);
    byNode.set(agent.position.nodeId, list);
  }
  const result = [...agents];
  for (const [nodeId, indices] of byNode) {
    const node = map.nodes.get(nodeId);
    if (!node) continue;
    const radius = node.kind === "junction" ? (indices.length > 1 ? JUNCTION_SPREAD : 0) : NODE_CLEARANCE;
    if (radius === 0) continue;
    indices.forEach((markerIndex, slot) => {
      const angle = Math.PI / 2 + (slot - (indices.length - 1) / 2) * 0.85;
      const marker = result[markerIndex]!;
      result[markerIndex] = {
        ...marker,
        position: { x: node.x + Math.cos(angle) * radius, z: node.z + Math.sin(angle) * radius },
      };
    });
  }
  return result;
}

/**
 * A cell can appear more than once in `observedCells` when two agents (or
 * one agent at two times) reported conflicting evidence for the same
 * physical cell - e.g. an old "burning" report contradicted by a fresher
 * "unburned" one. docs/ARCHITECTURE.md: "Fresh local hazard controls
 * planning" over a stale relay; rendering both entries would draw two
 * overlapping markers with no defined precedence between them. Keeps only
 * the entry with the greatest lastObservedAt per gridCellIndex.
 */
function resolveFireCells(view: CoordinatorView, _map: ScenarioMap): FireCellMarker[] {
  const latestByKey = new Map<number, CoordinatorView["observedCells"][number]>();
  for (const cell of view.observedCells) {
    const existing = latestByKey.get(cell.gridCellIndex);
    if (!existing || (cell.lastObservedAt as number) >= (existing.lastObservedAt as number)) {
      latestByKey.set(cell.gridCellIndex, cell);
    }
  }

  const fireCells: FireCellMarker[] = [];
  for (const cell of latestByKey.values()) {
    fireCells.push({
      key: `cell-${cell.gridCellIndex}`,
      gridCellIndex: cell.gridCellIndex,
      position: resolveGridCellPosition(cell.gridCellIndex),
      burnState: cell.burnState,
      stale: cell.stale,
      lastObservedAt: cell.lastObservedAt as number,
    });
  }
  return fireCells;
}
