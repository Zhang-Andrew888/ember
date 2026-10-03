import { AgentId } from "@ember/domain";
import { Incident, buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { CrewController, ScoutController, runControllers } from "./index.js";

/** Test support only (not exported from the package): deterministic scenarios and runners. */

export const crew1 = AgentId.parse("crew-1");
export const scoutId = AgentId.parse("scout");

export function patch(x: number, y: number): number[] {
  return [cellIndexOf(x, y)!, cellIndexOf(x + 25, y)!, cellIndexOf(x, y + 25)!, cellIndexOf(x + 25, y + 25)!];
}

/** Seeded PRNG (mulberry32): the only randomness allowed, so every run is reproducible. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIRE_SPOTS: readonly (readonly [number, number])[] = [
  [1500, 100],
  [1200, 300],
  [1500, 600],
  [300, 1500],
  [900, 900],
  [100, 100],
];

export interface Variation {
  readonly seed: string;
  readonly fire: readonly [number, number];
  readonly spread: number;
}

/** Variation number `n`, derived only from n. */
export function variation(n: number): Variation {
  const rng = seededRng(n * 7919 + 13);
  return { seed: `prop-${n}`, fire: FIRE_SPOTS[Math.floor(rng() * FIRE_SPOTS.length)]!, spread: 0.5 + rng() * 0.7 };
}

export function crewAndScoutScenario(v: Variation): SimScenario {
  const base = buildSyntheticScenario({ agents: ["crew-1", "scout"], sites: ["site-a"] });
  return { ...base, map: { ...base.map, initialFireCells: patch(v.fire[0], v.fire[1]) } };
}

/** Crew plans and knowledge, with the scout either observing for the coordinator or idle. */
export function runWithScout(v: Variation, scoutActive: boolean, untilMs: number) {
  const sc = crewAndScoutScenario(v);
  const inc = new Incident({ scenario: sc, seed: v.seed, overrides: { spreadMultiplier: v.spread, windShiftMs: 1e9, initialWindRad: 0 } });
  const crew = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: sc.map });
  const controllers = scoutActive ? [crew, new ScoutController({ agentId: scoutId, callsign: "Scout", role: "scout", map: sc.map })] : [crew];
  const hashes: string[] = [];
  for (let t = 0; t < untilMs && !inc.ended; t += 1000) {
    runControllers(inc, controllers, inc.simTimeMs + 1000);
    hashes.push(inc.projectAgent(crew1).inputHash);
  }
  const orders: string[] = [];
  for (const e of inc.inputLog) {
    if (e.input.kind === "commit_plan" && e.input.agentId === crew1) orders.push(`${e.appliedAtMs}:${JSON.stringify(e.input.plan.timedLegs)}:${e.input.plan.workInterval.startMs}`);
  }
  const coordinatorOnly = inc.coordinator.observations().filter((o) => o.sourceAgentId === scoutId).length;
  const blocked = inc.notices.filter((n) => n.kind === "entry_blocked").length;
  return { hashes, orders, coordinatorOnly, blocked, inc };
}
