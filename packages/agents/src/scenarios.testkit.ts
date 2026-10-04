import { AgentId, NodeId } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { RoadIndex, cellIndexOf } from "@ember/simulation/model";
import { CrewController, runControllers } from "./index.js";

/** Test support only (not exported from the package): deterministic scenarios and runners. */

export const crew1 = AgentId.parse("crew-1");
/** A second crew that only observes: its reports reach the coordinator, never crew-1. */
export const observerId = AgentId.parse("crew-2");

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

export function crewAndObserverScenario(v: Variation): SimScenario {
  const base = buildSyntheticScenario({ agents: ["crew-1", "crew-2"], sites: ["site-a"] });
  return {
    ...base,
    agents: base.agents.map((a) => (a.id === observerId ? { ...a, startNodeId: NodeId.parse("n-rs") } : a)),
    map: { ...base.map, initialFireCells: patch(v.fire[0], v.fire[1]) },
  };
}

/** Sends the observer out along the south-east road and back, so it senses fire the crew never does. */
export function sendObserverOut(inc: Incident, sc: SimScenario): void {
  inc.submit(
    authoredCommit({
      road: new RoadIndex(sc.map),
      agentId: observerId,
      planId: "observer-loop",
      knowledgeRevision: inc.agentRevision(observerId),
      startNode: NodeId.parse("n-rs"),
      departMs: 0,
      approach: ["e-rs-sc"],
      workSiteId: null,
      workMs: 0,
      back: ["e-rs-sc"],
    }),
  );
}

/** Crew plans and knowledge, with the observing crew either moving for the coordinator or parked. */
export function runWithObserver(v: Variation, observerMoves: boolean, untilMs: number) {
  const sc = crewAndObserverScenario(v);
  const inc = new Incident({ scenario: sc, seed: v.seed, overrides: { spreadMultiplier: v.spread, windShiftMs: 1e9, initialWindRad: 0 } });
  const crew = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: sc.map });
  const controllers = [crew];
  if (observerMoves) sendObserverOut(inc, sc);
  const hashes: string[] = [];
  for (let t = 0; t < untilMs && !inc.ended; t += 1000) {
    runControllers(inc, controllers, inc.simTimeMs + 1000);
    hashes.push(inc.projectAgent(crew1).inputHash);
  }
  const orders: string[] = [];
  for (const e of inc.inputLog) {
    if (e.input.kind === "commit_plan" && e.input.agentId === crew1) orders.push(`${e.appliedAtMs}:${JSON.stringify(e.input.plan.timedLegs)}:${e.input.plan.workInterval.startMs}`);
  }
  const coordinatorOnly = inc.coordinator.observations().filter((o) => o.sourceAgentId === observerId).length;
  const blocked = inc.notices.filter((n) => n.kind === "entry_blocked").length;
  return { hashes, orders, coordinatorOnly, blocked, inc };
}
