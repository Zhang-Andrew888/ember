import { describe, expect, it, vi } from "vitest";
import { Incident } from "@ember/simulation";
import { CrewController, ScoutController, runControllers } from "./index.js";
import { crew1, crewAndScoutScenario, runWithScout, scoutId, variation } from "./scenarios.testkit.js";

vi.setConfig({ testTimeout: 300_000 });

const SEEDS = 16;
const UNTIL_MS = 150_000;

describe("coordinator-only observations", () => {
  it("never change a crew's knowledge or plan until they are relayed to that crew", () => {
    const v = variation(0);
    const active = runWithScout(v, true, 240_000);
    const idle = runWithScout(v, false, 240_000);
    // Not vacuous: the coordinator holds scout observations the crew never received.
    expect(active.coordinatorOnly).toBeGreaterThan(idle.coordinatorOnly);
    expect(active.coordinatorOnly).toBeGreaterThan(0);
    expect(active.hashes).toEqual(idle.hashes);
    expect(active.orders.length).toBeGreaterThan(0);
    expect(active.orders).toEqual(idle.orders);
  });

  it.each(Array.from({ length: SEEDS }, (_, n) => n))("property over variation %i: crew knowledge and plans are identical with and without the scout's coordinator-only observations", (n) => {
    const v = variation(n);
    const active = runWithScout(v, true, UNTIL_MS);
    const idle = runWithScout(v, false, UNTIL_MS);
    expect(active.coordinatorOnly, "scout produced coordinator-only observations").toBeGreaterThan(0);
    expect(active.inc.projectAgent(crew1).knowledge.observations.some((o) => o.sourceAgentId === scoutId)).toBe(false);
    // Physical road blocking between agents is a different channel; the property is about information.
    expect(active.blocked).toBe(0);
    expect(active.hashes).toEqual(idle.hashes);
    expect(active.orders).toEqual(idle.orders);
  });

  it("the property is not vacuous: the crew commits plans in most variations", () => {
    const withPlans = Array.from({ length: SEEDS }, (_, n) => runWithScout(variation(n), false, UNTIL_MS).orders.length).filter((c) => c > 0).length;
    expect(withPlans).toBeGreaterThanOrEqual(SEEDS / 2);
  });

  it("positive control: an explicit relay to the crew does change what it knows", () => {
    const v = variation(0);
    const sc = crewAndScoutScenario(v);
    const inc = new Incident({ scenario: sc, seed: v.seed, overrides: { spreadMultiplier: v.spread, windShiftMs: 1e9, initialWindRad: 0 } });
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
