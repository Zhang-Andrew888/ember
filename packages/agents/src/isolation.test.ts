import { describe, expect, it, vi } from "vitest";
import { AgentId } from "@ember/domain";
import { Incident, buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { CrewController, ScoutController, runControllers } from "./index.js";

vi.setConfig({ testTimeout: 120_000 });

const crew1 = AgentId.parse("crew-1");
const scoutId = AgentId.parse("scout");
const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };

function patch(x: number, y: number): number[] {
  return [cellIndexOf(x, y)!, cellIndexOf(x + 25, y)!, cellIndexOf(x, y + 25)!, cellIndexOf(x + 25, y + 25)!];
}

function scenario(): SimScenario {
  const base = buildSyntheticScenario({ agents: ["crew-1", "scout"], sites: ["site-a"] });
  return { ...base, map: { ...base.map, initialFireCells: patch(1500, 100) } };
}

/** Crew plans and knowledge, with the scout either observing for the coordinator or idle. */
export function runWithScout(seed: string, scoutActive: boolean, untilMs = 240_000) {
  const sc = scenario();
  const inc = new Incident({ scenario: sc, seed, overrides: calm });
  const crew = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: sc.map });
  const controllers = scoutActive ? [crew, new ScoutController({ agentId: scoutId, callsign: "Scout", role: "scout", map: sc.map })] : [crew];
  const hashes: string[] = [];
  const orders: string[] = [];
  for (let t = 0; t < untilMs; t += 1000) {
    runControllers(inc, controllers, inc.simTimeMs + 1000);
    hashes.push(inc.projectAgent(crew1).inputHash);
  }
  for (const e of inc.inputLog) {
    if (e.input.kind === "commit_plan" && e.input.agentId === crew1) orders.push(`${e.appliedAtMs}:${JSON.stringify(e.input.plan.timedLegs)}:${e.input.plan.workInterval.startMs}`);
  }
  const coordinatorOnly = inc.coordinator.observations().filter((o) => o.sourceAgentId === scoutId).length;
  return { hashes, orders, coordinatorOnly, inc };
}

describe("coordinator-only observations", () => {
  it("never change a crew's knowledge or plan until they are relayed to that crew", () => {
    const active = runWithScout("iso-1", true);
    const idle = runWithScout("iso-1", false);
    // Not vacuous: the coordinator holds scout observations the crew never received.
    expect(active.coordinatorOnly).toBeGreaterThan(idle.coordinatorOnly);
    expect(active.coordinatorOnly).toBeGreaterThan(0);
    expect(active.hashes).toEqual(idle.hashes);
    expect(active.orders.length).toBeGreaterThan(0);
    expect(active.orders).toEqual(idle.orders);
    const crewKnows = new Set(active.inc.projectAgent(crew1).knowledge.observations.map((o) => o.sourceAgentId));
    expect(crewKnows.has(scoutId)).toBe(false);
  });

  it("positive control: an explicit relay to the crew does change what it knows", () => {
    const sc = scenario();
    const inc = new Incident({ scenario: sc, seed: "iso-1", overrides: calm });
    const crew = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: sc.map });
    const scout = new ScoutController({ agentId: scoutId, callsign: "Scout", role: "scout", map: sc.map });
    runControllers(inc, [crew, scout], 120_000);
    const before = inc.projectAgent(crew1).inputHash;
    const obs = inc.coordinator.observations().find((o) => o.sourceAgentId === scoutId);
    expect(obs).toBeDefined();
    inc.submit({ kind: "relay", observationId: obs!.id, toAgentId: crew1 });
    inc.advanceTo(inc.simTimeMs + 1000);
    expect(inc.projectAgent(crew1).inputHash).not.toBe(before);
  });
});
