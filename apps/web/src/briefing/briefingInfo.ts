import type { ScenarioMap } from "../map/scenarioMap.js";
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

/** The preview is shown only when its public map and initial observation match the selected start source. */
export function briefingContent(map: ScenarioMap, mock: boolean, search = ""): BriefingContent {
  const refugeNames = [...map.nodes.values()]
    .filter((node) => node.kind === "refuge" && node.label !== undefined)
    .map((node) => node.label!);

  if (mock) {
    const selection = resolveScenario(search);
    const first = selection?.snapshots?.[0] ?? mockStart();
    const sites = first.sites.map((site) => ({ name: site.name, value: site.value as number }));
    const callsigns = first.agents.map((agent) => agent.callsign);
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

  // The live start contract does not return its public map before Start.
  // Avoid presenting local geometry as a verified live starting picture.
  return { sites: map.briefing.sites, callsigns: map.briefing.callsigns, refugeNames, preview: null };
}
