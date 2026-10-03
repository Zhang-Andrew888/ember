import type { CoordinatorAgentView, CoordinatorView } from "@ember/domain";
import type { ScenarioMap, SceneNode } from "../../map/scenarioMap.js";
import {
  resolveAgentPosition,
  resolveCellPosition,
  resolveNodePosition,
  resolveEdgeHeading,
  type SceneHeading,
  type SceneVector,
} from "../../map/positions.js";
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
  readonly edgeId: string;
  readonly cellIndex: number;
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
  const agents: AgentMarker[] = [];
  for (const agent of view.agents) {
    const position = resolveAgentPosition(map, agent.position);
    if (!position) continue;
    const heading =
      agent.position.kind === "edge"
        ? resolveEdgeHeading(map, agent.position.edgeId, agent.position.direction)
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

  return { agents, sites, fireCells };
}

/**
 * A cell can appear more than once in `observedCells` when two agents (or
 * one agent at two times) reported conflicting evidence for the same
 * physical cell - e.g. an old "burning" report contradicted by a fresher
 * "unburned" one. docs/ARCHITECTURE.md: "Fresh local hazard controls
 * planning" over a stale relay; rendering both entries would draw two
 * overlapping markers with no defined precedence between them. Keeps only
 * the entry with the greatest lastObservedAt per edgeId+cellIndex.
 */
function resolveFireCells(view: CoordinatorView, map: ScenarioMap): FireCellMarker[] {
  const latestByKey = new Map<string, CoordinatorView["observedCells"][number]>();
  for (const cell of view.observedCells) {
    const key = `${cell.edgeId}:${cell.cellIndex}`;
    const existing = latestByKey.get(key);
    if (!existing || (cell.lastObservedAt as number) >= (existing.lastObservedAt as number)) {
      latestByKey.set(key, cell);
    }
  }

  const fireCells: FireCellMarker[] = [];
  for (const cell of latestByKey.values()) {
    const position = resolveCellPosition(map, cell.edgeId, cell.cellIndex);
    if (!position) continue;
    fireCells.push({
      key: `${cell.edgeId}:${cell.cellIndex}`,
      edgeId: cell.edgeId,
      cellIndex: cell.cellIndex,
      position,
      burnState: cell.burnState,
      stale: cell.stale,
      lastObservedAt: cell.lastObservedAt as number,
    });
  }
  return fireCells;
}
