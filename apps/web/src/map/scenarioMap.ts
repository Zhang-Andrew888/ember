/**
 * Local scene geometry for the demo scenario.
 *
 * packages/domain only carries topological positions (edgeId + distance, or
 * nodeId) - never x/y coordinates. The real road extract lands in Slice 0
 * (see docs/IMPLEMENTATION_PLAN.md); until then this module supplies a
 * placeholder layout, keyed by the same placeholder edge/node IDs used in
 * tests/fixtures/coordinator-view.fixture.ts, so the scene has something
 * concrete to render. Replacing this file is how a real OSM extract gets
 * wired in later - nothing outside apps/web depends on these coordinates.
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
  readonly lengthMeters: number;
  /** Number of equal-length fire cells this edge is divided into. */
  readonly cellCount: number;
}

export interface ScenarioMap {
  readonly nodes: ReadonlyMap<string, SceneNode>;
  readonly edges: ReadonlyMap<string, SceneEdge>;
}

const nodeList: SceneNode[] = [
  { id: "placeholder-node-refuge-west", x: -260, z: 20, kind: "refuge", label: "Refuge West" },
  { id: "placeholder-node-refuge-south", x: -220, z: -200, kind: "refuge", label: "Refuge South" },
  { id: "placeholder-node-site-a", x: 180, z: 60, kind: "site", label: "Ridge Cabins" },
  { id: "placeholder-node-site-b", x: 40, z: 220, kind: "site", label: "Waterworks" },
  { id: "placeholder-node-site-c", x: -140, z: 260, kind: "site", label: "Community Lodge" },
  { id: "junction-north-sector", x: -40, z: -40, kind: "junction" },
  { id: "junction-upwind-a", x: 60, z: -140, kind: "junction" },
  { id: "junction-upwind-b", x: 110, z: -110, kind: "junction" },
  { id: "junction-upwind-c", x: 160, z: -80, kind: "junction" },
  { id: "junction-north-spread-a", x: 0, z: 40, kind: "junction" },
  { id: "junction-north-spread-b", x: 20, z: 90, kind: "junction" },
];

const edgeList: SceneEdge[] = [
  {
    id: "placeholder-edge-refuge-west-site-a",
    fromNodeId: "placeholder-node-refuge-west",
    toNodeId: "placeholder-node-site-a",
    lengthMeters: 500,
    cellCount: 5,
  },
  {
    id: "placeholder-edge-refuge-south-north-sector",
    fromNodeId: "placeholder-node-refuge-south",
    toNodeId: "junction-north-sector",
    lengthMeters: 320,
    cellCount: 4,
  },
  {
    id: "placeholder-edge-fire-patch-1",
    fromNodeId: "junction-upwind-a",
    toNodeId: "junction-upwind-b",
    lengthMeters: 80,
    cellCount: 2,
  },
  {
    id: "placeholder-edge-fire-patch-2",
    fromNodeId: "junction-upwind-b",
    toNodeId: "junction-upwind-c",
    lengthMeters: 80,
    cellCount: 2,
  },
  {
    id: "placeholder-edge-north-spread-1",
    fromNodeId: "junction-north-sector",
    toNodeId: "junction-north-spread-a",
    lengthMeters: 200,
    cellCount: 4,
  },
  {
    id: "placeholder-edge-north-spread-2",
    fromNodeId: "junction-north-spread-a",
    toNodeId: "junction-north-spread-b",
    lengthMeters: 60,
    cellCount: 2,
  },
];

export const scenarioMap: ScenarioMap = {
  nodes: new Map(nodeList.map((node) => [node.id, node])),
  edges: new Map(edgeList.map((edge) => [edge.id, edge])),
};
