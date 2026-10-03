import type { ScenarioFile, ScenarioTerrain } from "./scenarioSchema.js";
import { DEFAULT_WORLD_METERS, worldToScene, type SceneVector } from "./worldScale.js";

/**
 * Scene geometry derived from a validated scenario file (see
 * scenarioSchema.ts / activeScenario.ts). packages/domain only carries
 * topological positions (edgeId + distance, or nodeId), never x/y, so the
 * scenario file is the single source of coordinates for roads, sites,
 * refuges and terrain.
 */

export interface SceneNode {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly kind: "refuge" | "site" | "junction";
  /** Display name for refuge/site nodes; absent for plain junctions. */
  readonly label?: string;
}

export interface SceneEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  /** Polyline length in sim metres (the unit of AgentPosition.distanceAlongPolyline). */
  readonly lengthMeters: number;
  /** Full polyline in scene units, endpoints included. */
  readonly points: readonly SceneVector[];
  /** Cumulative sim metres at each point (same length as points). */
  readonly cumulativeMeters: readonly number[];
  readonly singleCapacity: boolean;
}

export interface ScenarioSource {
  readonly kind: "scenarios-dir" | "local-snapshot";
  readonly name: string;
  /** Files in scenarios/ that were skipped, with the reason. */
  readonly skipped: ReadonlyArray<{ readonly name: string; readonly reason: string }>;
}

export interface ScenarioMap {
  readonly version: string;
  readonly source: ScenarioSource;
  readonly nodes: ReadonlyMap<string, SceneNode>;
  readonly edges: ReadonlyMap<string, SceneEdge>;
  readonly terrainSeed: string;
  readonly initialFireCells: readonly number[];
  readonly worldMeters: number;
  /** Public terrain layers; null when the scenario file carries none. */
  readonly terrain: ScenarioTerrain | null;
  /** Public briefing roster: site names/values and agent callsigns (empty when the file has none). */
  readonly briefing: { readonly sites: readonly { readonly name: string; readonly value: number }[]; readonly callsigns: readonly string[] };
}

export function buildScenarioMap(file: ScenarioFile, source: ScenarioSource): ScenarioMap {
  const worldMeters = file.terrain ? file.terrain.gridSize * file.terrain.cellMeters : DEFAULT_WORLD_METERS;
  const refugeNodes = new Map(file.map.refuges.map((refuge) => [refuge.nodeId as string, refuge.name]));
  const siteNodes = new Map(file.map.sites.map((site) => [site.nodeId as string, site.name]));

  const nodes = new Map<string, SceneNode>();
  const meterPoints = new Map<string, { x: number; y: number }>();
  for (const node of file.map.nodes) {
    meterPoints.set(node.id, { x: node.x, y: node.y });
    const refugeName = refugeNodes.get(node.id);
    const siteName = siteNodes.get(node.id);
    const kind = refugeName !== undefined ? "refuge" : siteName !== undefined ? "site" : "junction";
    const label = refugeName ?? siteName;
    const position = worldToScene(node.x, node.y, worldMeters);
    nodes.set(node.id, { id: node.id, x: position.x, z: position.z, kind, ...(label !== undefined ? { label } : {}) });
  }

  const edges = new Map<string, SceneEdge>();
  for (const edge of file.map.edges) {
    const from = meterPoints.get(edge.from)!;
    const to = meterPoints.get(edge.to)!;
    const polyline = [from, ...edge.via, to];
    const cumulativeMeters = [0];
    for (let i = 1; i < polyline.length; i++) {
      const a = polyline[i - 1]!;
      const b = polyline[i]!;
      cumulativeMeters.push(cumulativeMeters[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    edges.set(edge.id, {
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      lengthMeters: cumulativeMeters[cumulativeMeters.length - 1]!,
      points: polyline.map((point) => worldToScene(point.x, point.y, worldMeters)),
      cumulativeMeters,
      singleCapacity: edge.singleCapacity,
    });
  }

  return {
    version: file.version,
    source,
    nodes,
    edges,
    terrainSeed: file.map.terrainSeed,
    initialFireCells: file.map.initialFireCells,
    worldMeters,
    terrain: file.terrain ?? null,
    briefing: {
      sites: file.map.sites.map((site) => ({ name: site.name, value: site.value })),
      callsigns: file.agents.map((agent) => agent.callsign),
    },
  };
}
