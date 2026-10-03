import { AgentId, SequenceNumber, SimTimeMs, type EdgeId } from "@ember/domain";
import type { ForecastEnsemble, ForecastMember } from "@ember/forecast";
import { SIM_DEFAULTS, cellIndexOf, type PublicMap, type RoadIndex } from "@ember/simulation/model";

const N = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.gridSize;

export interface MemberSpec {
  readonly id: string;
  /** Ignition times by flat cell index; every other cell never ignites. */
  readonly ignition?: ReadonlyMap<number, number>;
}

/**
 * Test helper: an ensemble with exact, hand-written ignition times for exact navigation tests.
 * The members carry no fire physics; they only state when named cells ignite.
 */
export function makeEnsemble(
  _map: PublicMap,
  specs: readonly MemberSpec[],
  options: { nowMs?: number; horizonMs?: number; reliability?: ForecastEnsemble["reliability"]; revision?: number } = {},
): ForecastEnsemble {
  const now = options.nowMs ?? 0;
  const members: ForecastMember[] = specs.map((s) => {
    const ignitionMs = new Float64Array(N).fill(Infinity);
    for (const [cell, t] of s.ignition ?? []) ignitionMs[cell] = t;
    return {
      id: s.id,
      kind: "sampled",
      params: { spreadMultiplier: 1, initialWindRad: 0, windShiftMs: 1e9, postShiftWindRad: 1 },
      ignitionMs,
      rolloutEndMs: 10_000_000,
    };
  });
  const reliability = options.reliability ?? "reliable";
  return {
    version: 1,
    inputHash: "test",
    knowledgeRevision: options.revision ?? 0,
    members: reliability === "reliable" ? members : [],
    provisional: reliability === "reliable" ? [] : members,
    reliability,
    builtAtMs: SimTimeMs.parse(now),
    horizonEndMs: options.horizonMs === undefined ? now + 1_800_000 : now + options.horizonMs,
    widenFactor: 1,
    ranges: {
      spreadMultiplier: { min: 0.7, max: 1.3 },
      windOffsetDeg: { min: -30, max: 30 },
      shiftTimeMs: { min: 450_000, max: 650_000 },
      postShiftDeg: { min: 45, max: 100 },
    },
    sourceSnapshot: {
      agentId: AgentId.parse("test"),
      revision: SequenceNumber.parse(options.revision ?? 0),
      asOfSimTimeMs: SimTimeMs.parse(now),
      observations: [],
    },
  };
}

/** Flat cell index at a fraction of an edge's length. */
export function cellOnEdge(road: RoadIndex, edgeId: EdgeId | string, fraction: number): number {
  const edge = road.mustEdge(edgeId as EdgeId);
  const p = road.pointAlong(edge, edge.length * fraction);
  const cell = cellIndexOf(p.x, p.y);
  if (cell === null) throw new Error("off grid");
  return cell;
}

/** Every distinct cell an edge crosses. */
export function cellsOfEdge(road: RoadIndex, edgeId: EdgeId | string): number[] {
  return [...new Set(road.mustEdge(edgeId as EdgeId).cells.map((c) => c.cell))];
}
