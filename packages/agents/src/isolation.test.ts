import { describe, expect, it, vi } from "vitest";
import { Incident } from "@ember/simulation";
import { CrewController, runControllers } from "./index.js";
import { crew1, crewAndObserverScenario, observerId, runWithObserver, sendObserverOut, variation } from "./scenarios.testkit.js";

vi.setConfig({ testTimeout: 300_000 });

const SEEDS = 16;
const UNTIL_MS = 150_000;

describe("coordinator-only observations", () => {
  it("never change a crew's knowledge or plan until they are relayed to that crew", () => {
    const v = variation(0);
    const active = runWithObserver(v, true, 240_000);
    const idle = runWithObserver(v, false, 240_000);
    // Not vacuous: the coordinator holds another crew's observations this crew never received.
    expect(active.coordinatorOnly).toBeGreaterThan(idle.coordinatorOnly);
    expect(active.coordinatorOnly).toBeGreaterThan(0);
    expect(active.hashes).toEqual(idle.hashes);
    expect(active.orders.length).toBeGreaterThan(0);
    expect(active.orders).toEqual(idle.orders);
  });

  it.each(Array.from({ length: SEEDS }, (_, n) => n))("property over variation %i: crew knowledge and plans are identical with and without another crew's coordinator-only observations", (n) => {
    const v = variation(n);
    const active = runWithObserver(v, true, UNTIL_MS);
    const idle = runWithObserver(v, false, UNTIL_MS);
    expect(active.coordinatorOnly, "the observing crew produced coordinator-only observations").toBeGreaterThan(0);
    expect(active.inc.projectAgent(crew1).knowledge.observations.some((o) => o.sourceAgentId === observerId)).toBe(false);
    // Physical road blocking between agents is a different channel; the property is about information.
    expect(active.blocked).toBe(0);
    expect(active.hashes).toEqual(idle.hashes);
    expect(active.orders).toEqual(idle.orders);
  });

  it("the property is not vacuous: the crew commits plans in most variations", () => {
    const withPlans = Array.from({ length: SEEDS }, (_, n) => runWithObserver(variation(n), false, UNTIL_MS).orders.length).filter((c) => c > 0).length;
    expect(withPlans).toBeGreaterThanOrEqual(SEEDS / 2);
  });

  it("positive control: an explicit relay to the crew does change what it knows", () => {
    const v = variation(0);
    const sc = crewAndObserverScenario(v);
    const inc = new Incident({ scenario: sc, seed: v.seed, overrides: { spreadMultiplier: v.spread, windShiftMs: 1e9, initialWindRad: 0 } });
    const crew = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: sc.map });
    sendObserverOut(inc, sc);
    runControllers(inc, [crew], 120_000);
    const before = inc.projectAgent(crew1).inputHash;
    const obs = inc.coordinator.observations().find((o) => o.sourceAgentId === observerId);
    expect(obs).toBeDefined();
    inc.submit({ kind: "relay", observationId: obs!.id, toAgentId: crew1 });
    inc.advanceTo(inc.simTimeMs + 1000);
    expect(inc.projectAgent(crew1).inputHash).not.toBe(before);
  });
});
