import type { PublicScenarioBriefing } from "@ember/domain";
import { omitScoutCallsigns } from "../format/omitScout.js";
import type { ScenarioMap } from "../map/scenarioMap.js";
import { worldToScene } from "../map/worldScale.js";
import { recordedMockStartSnapshot } from "../net/recordedMockPlayback.js";
import { resolveScenario } from "../net/scenarioSelection.js";

export interface BriefingSite {
  readonly name: string;
  readonly value: number;
}

export interface PublicPreview {
  readonly roads: readonly { readonly id: string; readonly points: readonly { readonly x: number; readonly z: number }[] }[];
  readonly sites: readonly { readonly name: string; readonly x: number; readonly z: number }[];
  readonly refuges: readonly { readonly name: string; readonly x: number; readonly z: number }[];
  readonly initialFireCells: readonly number[];
  readonly gridSize: number;
  readonly worldMeters: number;
}

export interface BriefingContent {
  readonly sites: readonly BriefingSite[];
  readonly callsigns: readonly string[];
  readonly refugeNames: readonly string[];
  readonly preview: PublicPreview | null;
}

let recordedStart: ReturnType<typeof recordedMockStartSnapshot> | null = null;

function mockStart() {
  recordedStart ??= recordedMockStartSnapshot();
  return recordedStart;
}

function publicPreview(map: ScenarioMap, fireCells: readonly number[]): PublicPreview {
  const named = (kind: "site" | "refuge") => [...map.nodes.values()]
    .filter((node) => node.kind === kind && node.label !== undefined)
    .map((node) => ({ name: node.label!, x: node.x, z: node.z }));
  return {
    roads: [...map.edges.values()].map((edge) => ({ id: edge.id, points: edge.points })),
    sites: named("site"),
    refuges: named("refuge"),
    initialFireCells: fireCells,
    gridSize: map.terrain?.gridSize ?? 64,
    worldMeters: map.worldMeters,
  };
}

/**
 * Briefing built from the server's own pre-start scenario (`GET /scenario`), so the live starting
 * picture is what the server will run rather than the locally bundled map. Metres are mapped to
 * scene units with the server's grid dimensions, matching how the live scene is drawn later.
 */
export function liveBriefingContent(scenario: PublicScenarioBriefing): BriefingContent {
  const worldMeters = scenario.gridSize * scenario.cellMeters;
  const nodes = new Map(scenario.nodes.map((node) => [node.id as string, node]));
  const place = (nodeId: string) => {
    const node = nodes.get(nodeId)!;
    return worldToScene(node.x, node.y, worldMeters);
  };
  const named = (entries: readonly { readonly name: string; readonly nodeId: string }[]) =>
    entries.map((entry) => ({ name: entry.name, ...place(entry.nodeId) }));

  const preview: PublicPreview = {
    roads: scenario.edges.map((edge) => {
      const from = nodes.get(edge.from as string)!;
      const to = nodes.get(edge.to as string)!;
      return {
        id: edge.id as string,
        points: [from, ...edge.via, to].map((point) => worldToScene(point.x, point.y, worldMeters)),
      };
    }),
    sites: named(scenario.sites),
    refuges: named(scenario.refuges),
    initialFireCells: [...scenario.initialFireCells].sort((a, b) => a - b),
    gridSize: scenario.gridSize,
    worldMeters,
  };

  return {
    sites: scenario.sites.map((site) => ({ name: site.name, value: site.value })),
    callsigns: omitScoutCallsigns(scenario.agents.filter((agent) => agent.role !== "scout").map((agent) => agent.callsign)),
    refugeNames: scenario.refuges.map((refuge) => refuge.name),
    preview,
  };
}

/**
 * The preview is shown only when it is known to match what will run: the recorded start snapshot
 * in mock mode, or the server's published scenario in live mode.
 */
export function briefingContent(
  map: ScenarioMap,
  mock: boolean,
  search = "",
  liveScenario: PublicScenarioBriefing | null = null,
): BriefingContent {
  if (!mock && liveScenario !== null) return liveBriefingContent(liveScenario);
  const refugeNames = [...map.nodes.values()]
    .filter((node) => node.kind === "refuge" && node.label !== undefined)
    .map((node) => node.label!);

  if (mock) {
    const selection = resolveScenario(search);
    const first = selection?.snapshots?.[0] ?? mockStart();
    const sites = first.sites.map((site) => ({ name: site.name, value: site.value as number }));
    // The demo presents crews only (#118), even if a recorded roster still lists a scout.
    const callsigns = omitScoutCallsigns(first.agents.map((agent) => agent.callsign));
    const mapMatchesSites = sites.length === map.briefing.sites.length && sites.every((site) =>
      map.briefing.sites.some((mapped) => mapped.name === site.name && mapped.value === site.value));
    const initialBurning = first.observedCells
      .filter((cell) => cell.burnState === "burning" && (cell.lastObservedAt as number) === 0)
      .map((cell) => cell.gridCellIndex as number)
      .sort((a, b) => a - b);
    const expected = [...map.initialFireCells].sort((a, b) => a - b);
    const mapMatchesObservation = initialBurning.length === expected.length &&
      initialBurning.every((cell, index) => cell === expected[index]);
    return {
      sites,
      callsigns,
      refugeNames,
      preview: mapMatchesSites && mapMatchesObservation ? publicPreview(map, initialBurning) : null,
    };
  }

  // Without the server's scenario (not fetched yet, or an older server), do not present local
  // geometry as a verified live starting picture.
  return { sites: map.briefing.sites, callsigns: omitScoutCallsigns(map.briefing.callsigns), refugeNames, preview: null };
}
