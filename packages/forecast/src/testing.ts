import { AgentId, Meters, Observation, ObservationId, SimTimeMs, type SiteId } from "@ember/domain";
import { type AgentKnowledgeSnapshot, KnowledgeStore } from "@ember/knowledge";
import {
  FireField,
  SIM_DEFAULTS,
  cellsWithin,
  createTerrain,
  type FireParams,
  type PublicMap,
  RoadIndex,
  refugeCells,
} from "@ember/simulation/model";

export interface Observer {
  readonly agentId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Test helper: run a "true" fire with explicit parameters and publish observations the way
 * the simulator's sensor does (first sighting, then changes only) for stationary observers.
 */
export function observeFire(
  map: PublicMap,
  truth: FireParams,
  observers: readonly Observer[],
  untilMs: number,
  everyMs = 5000,
): Observation[] {
  const road = new RoadIndex(map);
  const field = new FireField(createTerrain(map.terrainSeed), refugeCells(road, SIM_DEFAULTS.refugeRadiusM));
  field.ignite(map.initialFireCells, 0);
  const memory = new Map<string, Uint8Array>();
  const out: Observation[] = [];
  const sample = (t: number): void => {
    for (const o of observers) {
      const mem = memory.get(o.agentId) ?? new Uint8Array(SIM_DEFAULTS.gridSize ** 2);
      memory.set(o.agentId, mem);
      const fields: Observation["observedFields"] = [];
      for (const cell of cellsWithin(o.x, o.y, SIM_DEFAULTS.observationRadiusM)) {
        const s = field.state[cell];
        const burnState = s === 2 ? "burning" : s === 3 ? "burned" : "unburned";
        const code = s === 2 ? 2 : s === 3 ? 3 : 1;
        if (mem[cell] === code) continue;
        mem[cell] = code;
        fields.push({ kind: "cell", gridCellIndex: cell, burnState });
      }
      if (fields.length === 0) continue;
      out.push(
        Observation.parse({
          id: ObservationId.parse(`obs:${o.agentId}:${t}`),
          sourceAgentId: AgentId.parse(o.agentId),
          observedAt: SimTimeMs.parse(t),
          receivedAt: SimTimeMs.parse(t),
          spatialFootprint: { centerX: Meters.parse(o.x), centerY: Meters.parse(o.y), radius: Meters.parse(SIM_DEFAULTS.observationRadiusM) },
          observedFields: fields,
        }),
      );
    }
  };
  sample(0);
  for (let t = 1000; t <= untilMs; t += 1000) {
    field.step(t, 1000, truth);
    if (t % everyMs === 0) sample(t);
  }
  return out;
}

/** Test helper: the briefing observation every agent starts with. */
export function briefingObservation(map: PublicMap, sites: readonly SiteId[] = []): Observation {
  return Observation.parse({
    id: "obs:briefing",
    sourceAgentId: "briefing",
    observedAt: 0,
    receivedAt: 0,
    spatialFootprint: { centerX: 800, centerY: 800, radius: 1200 },
    observedFields: [
      ...map.initialFireCells.map((gridCellIndex) => ({ kind: "cell", gridCellIndex, burnState: "burning" as const })),
      ...sites.map((siteId) => ({ kind: "site", siteId, completedWork: 0, damage: 0, destroyed: false })),
    ],
  });
}

export function snapshotOf(agentId: string, observations: readonly Observation[], asOfMs: number): AgentKnowledgeSnapshot {
  const store = new KnowledgeStore(AgentId.parse(agentId));
  for (const o of observations) store.ingest(o);
  return store.snapshot(SimTimeMs.parse(asOfMs));
}
