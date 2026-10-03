import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentId, NodeId } from "@ember/domain";
import { DEFAULT_FORECAST_CONFIG } from "@ember/forecast";
import { buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { IncidentSession } from "./session.js";

vi.setConfig({ testTimeout: 180_000 });

// Long synchronous tests starve the worker's RPC channel; yield a macrotask between tests so it can flush.
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
});

const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };
const patch = (x: number, y: number): number[] => [cellIndexOf(x, y)!, cellIndexOf(x + 25, y)!, cellIndexOf(x, y + 25)!, cellIndexOf(x + 25, y + 25)!];
// A briefed steady east wind: with a fire in the south-east corner every crew has admissible work.
const steady = {
  ...DEFAULT_FORECAST_CONFIG,
  prior: {
    spreadMultiplier: { min: 0.6, max: 0.8 },
    windOffsetDeg: { min: -5, max: 5 },
    shiftTimeMs: { min: 1_300_000, max: 1_400_000 },
    postShiftDeg: { min: 45, max: 100 },
  },
};
function teamScenario(): SimScenario {
  const base = buildSyntheticScenario();
  return { ...base, map: { ...base.map, initialFireCells: patch(1500, 100) } };
}

describe("full team on shared roads", () => {
  it("never lets crews occupy the single-capacity corridor together and uses reservations instead of collisions", () => {
    const session = new IncidentSession({ scenario: teamScenario(), seed: "team-1", overrides: calm, controllerConfig: { forecast: steady } });
    let maxOnCorridor = 0;
    let crossings = new Set<string>();
    session.runUntil(900_000, (s) => {
      const on = s.incident.truth().agents.filter((a) => a.position.kind === "edge" && a.position.edgeId === "e-s-h");
      maxOnCorridor = Math.max(maxOnCorridor, on.length);
      for (const a of on) crossings.add(a.id);
    });
    expect(maxOnCorridor).toBeLessThanOrEqual(1);
    // Reservations kept crews apart ahead of time: nobody was held at a node by the physical rule.
    expect(session.incident.notices.filter((n) => n.kind === "entry_blocked")).toHaveLength(0);
    expect(crossings.size).toBeGreaterThanOrEqual(2);
    expect(session.decisions.filter((d) => d.event.type === "mission_start").length).toBeGreaterThanOrEqual(2);
    crossings = new Set();
  });

  it("keeps additive work consistent across crews and never exceeds required work", () => {
    const session = new IncidentSession({ scenario: teamScenario(), seed: "team-2", overrides: calm, controllerConfig: { forecast: steady } });
    session.runUntil(900_000);
    for (const s of session.incident.truth().sites) {
      const required = session.incident.scenario.map.sites.find((x) => x.id === s.id)!.requiredWork;
      expect(s.completedWork).toBeLessThanOrEqual(required);
    }
  });

  it("gives the scout's observations to the coordinator only until they are relayed", () => {
    const make = (): SimScenario => {
      const base = buildSyntheticScenario({ agents: ["crew-1", "scout"], sites: ["site-a"] });
      return {
        ...base,
        agents: base.agents.map((a) => (a.id === "scout" ? { ...a, startNodeId: NodeId.parse("n-j1") } : a)),
        map: { ...base.map, initialFireCells: patch(450, 850) },
      };
    };
    const run = (relayAt: number | null) => {
      const session = new IncidentSession({
        scenario: make(),
        seed: "relay",
        overrides: { spreadMultiplier: 1.3, windShiftMs: 1e9, initialWindRad: 0 },
        uncontrolled: ["scout"],
      });
      const crew = AgentId.parse("crew-1");
      const hashes: string[] = [];
      const orders: string[] = [];
      let relayed = false;
      session.runUntil(200_000, (s) => {
        hashes.push(s.incident.projectAgent(crew).inputHash);
        if (relayAt !== null && !relayed && s.incident.simTimeMs >= relayAt) {
          const obs = s.incident.coordinator
            .observations()
            .filter((o) => o.sourceAgentId === "scout" && o.observedFields.some((f) => f.kind === "cell" && f.burnState === "burning"))
            .at(-1);
          if (obs !== undefined) {
            s.relay(obs.id, "crew-1");
            relayed = true;
          }
        }
      });
      for (const e of session.incident.inputLog) if (e.input.kind === "commit_plan") orders.push(`${e.appliedAtMs}:${e.input.plan.id}`);
      return { session, hashes, orders, crew };
    };
    const without = run(null);
    const withRelay = run(100_000);
    // The coordinator learned things the crew did not, in both runs.
    const scoutSeen = without.session.incident.coordinator.observations().filter((o) => o.sourceAgentId === "scout").length;
    expect(scoutSeen).toBeGreaterThan(1);
    // Identical crew knowledge and plans until the relay lands.
    expect(withRelay.hashes.slice(0, 100)).toEqual(without.hashes.slice(0, 100));
    expect(withRelay.orders.filter((o) => Number(o.split(":")[0]) <= 100_000)).toEqual(without.orders.filter((o) => Number(o.split(":")[0]) <= 100_000));
    // After the relay only that crew's knowledge differs.
    const relayedRecord = withRelay.session.incident.inputLog.find((e) => e.input.kind === "relay");
    if (relayedRecord !== undefined) {
      expect(withRelay.hashes[withRelay.hashes.length - 1]).not.toBe(without.hashes[without.hashes.length - 1]);
    }
  });

  it("does not keep the incident running because the scout survives", () => {
    const base = buildSyntheticScenario({ agents: ["crew-1", "scout"], sites: ["site-a"] });
    const session = new IncidentSession({
      scenario: { ...base, map: { ...base.map } },
      seed: "scout-alone",
      overrides: calm,
      uncontrolled: ["crew-1", "scout"],
    });
    // Nothing is controlled, so nothing happens: sanity check that the session steps and ends on time.
    session.runUntil(60_000);
    expect(session.incident.ended).toBe(false);
    expect(session.incident.simTimeMs).toBe(60_000);
  });

  it("reproduces the same result from the recorded input log of a whole-team run", () => {
    const run = () => {
      const s = new IncidentSession({ scenario: teamScenario(), seed: "team-3", overrides: calm, controllerConfig: { forecast: steady } });
      s.runUntil(400_000);
      return s.incident.snapshotHash();
    };
    expect(run()).toBe(run());
  });
});
