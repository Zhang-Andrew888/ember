import { z } from "zod";
import { AgentId, AgentRole, EdgeId, NodeId, ScenarioVersion, SiteId } from "@ember/domain";
import { PublicMap, cellIndexOf, hashValue } from "./model/index.js";

export const AgentSpec = z.object({
  id: AgentId,
  role: AgentRole,
  callsign: z.string(),
  startNodeId: NodeId,
});
export type AgentSpec = z.infer<typeof AgentSpec>;

/** Everything needed to start an incident except the private world seed. */
export const SimScenario = z.object({
  version: ScenarioVersion,
  map: PublicMap,
  agents: z.array(AgentSpec).min(1),
  briefing: z.string(),
});
export type SimScenario = z.infer<typeof SimScenario>;

export function scenarioHash(scenario: SimScenario): string {
  return hashValue(scenario);
}

export interface SyntheticOptions {
  /** Agent ids to include; defaults to crew-1, crew-2, crew-3 and scout. */
  readonly agents?: readonly string[];
  /** Site ids to include; defaults to site-a, site-b and site-c. */
  readonly sites?: readonly string[];
  readonly terrainSeed?: string;
  readonly version?: string;
}

const NODES: readonly [string, number, number][] = [
  ["n-rw", 100, 800],
  ["n-rs", 800, 100],
  ["n-j1", 400, 800],
  ["n-s", 700, 600],
  ["n-h", 1000, 800],
  ["n-n", 500, 1200],
  ["n-sa", 1200, 1050],
  ["n-sb", 1250, 800],
  ["n-sc", 1200, 550],
];

const EDGES: readonly [string, string, string, boolean][] = [
  ["e-rw-j1", "n-rw", "n-j1", false],
  ["e-j1-s", "n-j1", "n-s", false],
  ["e-s-h", "n-s", "n-h", true],
  ["e-j1-n", "n-j1", "n-n", false],
  ["e-n-h", "n-n", "n-h", false],
  ["e-rs-s", "n-rs", "n-s", false],
  ["e-h-sa", "n-h", "n-sa", false],
  ["e-h-sb", "n-h", "n-sb", false],
  ["e-h-sc", "n-h", "n-sc", false],
];

const ALL_AGENTS: readonly [string, "protection_crew" | "scout", string, string][] = [
  ["crew-1", "protection_crew", "Crew 1", "n-rw"],
  ["crew-2", "protection_crew", "Crew 2", "n-rw"],
  ["crew-3", "protection_crew", "Crew 3", "n-rs"],
  ["scout", "scout", "Scout", "n-rs"],
];

const ALL_SITES: readonly [string, string, string, number, number][] = [
  ["site-a", "Ridge Cabins", "n-sa", 300, 1],
  ["site-b", "Waterworks", "n-sb", 450, 1.5],
  ["site-c", "Community Lodge", "n-sc", 600, 2],
];

/**
 * Authored synthetic graph used for tests and the no-provider harness. It is NOT the real
 * Oakland extract: geometry, sites, refuges and ignition are all authored. It has a loop
 * with two approaches (south 722 m, north 1052 m), a single-capacity segment (e-s-h) with
 * waiting nodes at both ends, three site branches and three scouting points.
 */
export function buildSyntheticScenario(options: SyntheticOptions = {}): SimScenario {
  const agentFilter = options.agents;
  const siteFilter = options.sites;
  const initialFireCells = [
    cellIndexOf(230, 1100),
    cellIndexOf(255, 1100),
    cellIndexOf(230, 1125),
    cellIndexOf(255, 1125),
  ].filter((c): c is number => c !== null);

  const sites = ALL_SITES.filter(([id]) => siteFilter === undefined || siteFilter.includes(id));
  const scenario: SimScenario = {
    version: ScenarioVersion.parse(options.version ?? "synthetic-v1"),
    map: {
      nodes: NODES.map(([id, x, y]) => ({ id: NodeId.parse(id), x, y })),
      edges: EDGES.map(([id, from, to, singleCapacity]) => ({
        id: EdgeId.parse(id),
        from: NodeId.parse(from),
        to: NodeId.parse(to),
        via: [],
        singleCapacity,
      })),
      sites: sites.map(([id, name, nodeId, requiredWork, value]) => ({
        id: SiteId.parse(id),
        name,
        nodeId: NodeId.parse(nodeId),
        requiredWork,
        value,
      })),
      refuges: [
        { id: "refuge-west", name: "Refuge West", nodeId: NodeId.parse("n-rw") },
        { id: "refuge-south", name: "Refuge South", nodeId: NodeId.parse("n-rs") },
      ],
      scoutPoints: [NodeId.parse("n-n"), NodeId.parse("n-s"), NodeId.parse("n-h")],
      terrainSeed: options.terrainSeed ?? "synthetic-terrain",
      initialFireCells,
    },
    agents: ALL_AGENTS.filter(([id]) => agentFilter === undefined || agentFilter.includes(id)).map(
      ([id, role, callsign, start]) => ({
        id: AgentId.parse(id),
        role,
        callsign,
        startNodeId: NodeId.parse(start),
      }),
    ),
    briefing: "Synthetic training scenario: authored roads, sites, refuges and ignition.",
  };
  return SimScenario.parse(scenario);
}

export { refugeCells } from "./model/index.js";
