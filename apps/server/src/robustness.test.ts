import { describe, expect, it, vi } from "vitest";
import { replayRecord, recordOf } from "@ember/simulation";
import { SIM_DEFAULTS } from "@ember/simulation/model";
import { VARIANTS, factoryFor, overridesForSeed } from "./evaluation.js";
import { ScriptedCoordinatorPolicy } from "./policy.js";
import { IncidentSession } from "./session.js";
import { buildSyntheticScenario } from "@ember/simulation";

vi.setConfig({ testTimeout: 600_000 });

describe("controller output is always valid for the simulator", () => {
  for (const variant of VARIANTS) {
    it(`${variant}: no structurally invalid, stale or rejected plans across varied seeds`, () => {
      const rejected: string[] = [];
      const scenario = buildSyntheticScenario();
      ["rb-1", "rb-2", "rb-3", "rb-4"].forEach((seed, i) => {
        const session = new IncidentSession({ scenario, seed, overrides: overridesForSeed(seed, i), factory: factoryFor(variant) });
        const policy = new ScriptedCoordinatorPolicy(session, scenario.map);
        while (!session.incident.ended && session.incident.simTimeMs < 600_000) {
          session.step();
          policy.tick();
          const onCorridor = session.incident.truth().agents.filter((a) => a.position.kind === "edge" && a.position.edgeId === "e-s-h" && a.state !== "lost");
          expect(onCorridor.length).toBeLessThanOrEqual(1);
        }
        for (const n of session.incident.notices) if (n.kind === "plan_rejected") rejected.push(`${seed}:${n.agentId}:${n.reason}`);
        const replay = replayRecord(recordOf(session.incident));
        expect(replay.hashMatches).toBe(true);
        void SIM_DEFAULTS;
      });
      expect(rejected).toEqual([]);
    });
  }
});
