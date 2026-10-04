import type { CoordinatorAgentView, CoordinatorCurrentFireView, CoordinatorView } from "@ember/domain";
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
import { ageOf } from "./staleness.js";
import { displayState, type AgentDisplayState } from "./models/markerCues.js";
import { siteProtectionStatus, type SiteProtectionStatus } from "../../format/reports.js";
import { currentFireForDisplay, type AppPhase } from "../../replay/truthGate.js";

export interface AgentMarker {
  readonly id: string;
  readonly callsign: string;
  readonly role: CoordinatorAgentView["role"];
  readonly state: AgentDisplayState;
  readonly position: SceneVector;
  readonly heading: SceneHeading | null;
  /** Sim ms since the coordinator last heard from this agent (its position is that old). */
  readonly ageMs: number | null;
}

export interface SiteMarker {
  readonly id: string;
  readonly name: string;
  readonly position: SceneVector;
  readonly protectionStatus: SiteProtectionStatus;
  readonly damage: number | null;
  readonly stale: boolean;
  /** Sim ms since this site was last observed; null = never. */
  readonly ageMs: number | null;
}

/**
 * Where a displayed fire cell's state comes from, so inspection can say so and the three kinds stay
 * visually distinct: the live coordinator feed (`current-fire`), a crew sighting that may be old
 * (`observed`), or the replay-only full simulated fire (`replay-truth`).
 */
export type FireCellSource = "current-fire" | "observed" | "replay-truth";

export interface FireCellMarker {
  readonly key: string;
  readonly gridCellIndex: number;
  readonly position: SceneVector;
  readonly burnState: "unburned" | "burning" | "burned";
  readonly stale: boolean;
  readonly source: FireCellSource;
  /**
   * Sim time this state describes: the observation time for `observed` cells (docs/FRONTEND.md),
   * `currentFire.simTimeMs` for `current-fire` cells. Always simulation time, never wall time.
   */
  readonly lastObservedAt: number;
  /** Sim ms since `lastObservedAt` (0 for current-fire cells). */
  readonly ageMs: number;
  /**
   * REPLAY ONLY: this fire is real but the coordinator never observed it. Never set on live
   * data; only replay/recording.ts (mergeTruthCells) produces it.
   */
  readonly unseen?: boolean;
}

/** The authorized live fire across the full map (#114): every burning and burned cell in the feed. */
export interface CurrentFireLayer {
  /** `currentFire.simTimeMs`: the incident time this snapshot describes. */
  readonly simTimeMs: number;
  readonly cells: FireCellMarker[];
  readonly burningCount: number;
  readonly burnedCount: number;
}

export interface SceneEntities {
  readonly agents: AgentMarker[];
  readonly sites: SiteMarker[];
  /** Observed belief (crew sightings), plus replay-only unseen truth cells. Not the current fire. */
  readonly fireCells: FireCellMarker[];
  /** Live current fire; null when the view carries none (older sender, mock, fixture): nothing is invented. */
  readonly currentFire: CurrentFireLayer | null;
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
export function buildSceneEntities(
  view: CoordinatorView,
  map: ScenarioMap,
  options: { readonly phase?: AppPhase } = {},
): SceneEntities {
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
      ageMs: ageOf(view.simTimeMs as number, site.lastObservedAt as number | null),
    });
  }

  const fireCells = resolveFireCells(view, map);
  const currentFire = resolveCurrentFire(
    currentFireForDisplay({ phase: options.phase ?? "live", currentFire: view.currentFire }),
    map,
  );

  return {
    agents,
    sites,
    fireCells,
    currentFire,
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
      state: displayState(agent.state, view.agentPlans.find((plan) => plan.agentId === agent.id)?.phase),
      position,
      heading,
      ageMs: ageOf(view.simTimeMs as number, agent.reportedAt as number),
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
function resolveFireCells(view: CoordinatorView, map: ScenarioMap): FireCellMarker[] {
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
      position: resolveGridCellPosition(map, cell.gridCellIndex),
      burnState: cell.burnState,
      stale: cell.stale,
      source: "observed",
      lastObservedAt: cell.lastObservedAt as number,
      ageMs: ageOf(view.simTimeMs as number, cell.lastObservedAt as number) ?? 0,
    });
  }
  return fireCells;
}

/**
 * Scene cells for every burning and burned cell in the authorized live feed. They are independent
 * of `observedCells`, so fire outside crew sightings is drawn (#114). Unburned and nonburnable cells
 * are implied by absence and produce no marker.
 */
function resolveCurrentFire(fire: CoordinatorCurrentFireView | null, map: ScenarioMap): CurrentFireLayer | null {
  if (fire === null) return null;
  const simTimeMs = fire.simTimeMs as number;
  const toMarker = (gridCellIndex: number, burnState: "burning" | "burned"): FireCellMarker => ({
    key: `current-${gridCellIndex}`,
    gridCellIndex,
    position: resolveGridCellPosition(map, gridCellIndex),
    burnState,
    stale: false,
    source: "current-fire",
    lastObservedAt: simTimeMs,
    ageMs: 0,
  });
  return {
    simTimeMs,
    cells: [
      ...fire.burningCells.map((index) => toMarker(index, "burning")),
      ...fire.burnedCells.map((index) => toMarker(index, "burned")),
    ],
    burningCount: fire.burningCells.length,
    burnedCount: fire.burnedCells.length,
  };
}

/**
 * Cells that drive flames, ground light, char and trees. With a current-fire layer the actual fire
 * is that layer (plus replay-only unseen cells); observed beliefs are then only outlined, never lit.
 * Without one (older sender) the observed cells are lit as before.
 */
export function litFireCells(
  entities: Pick<SceneEntities, "fireCells" | "currentFire">,
  show: { readonly currentFire: boolean; readonly observed: boolean },
): FireCellMarker[] {
  if (entities.currentFire === null) return show.observed ? entities.fireCells : [];
  return [
    ...(show.currentFire ? entities.currentFire.cells : []),
    ...(show.observed ? entities.fireCells.filter((cell) => cell.source === "replay-truth") : []),
  ];
}
