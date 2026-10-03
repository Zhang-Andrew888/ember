import { afterEach, describe, expect, it, vi } from "vitest";
import { replayRecord, recordOf } from "@ember/simulation";
import { VARIANTS, factoryFor, overridesForSeed } from "./evaluation.js";
import { ScriptedCoordinatorPolicy } from "./policy.js";
import { IncidentSession } from "./session.js";
import { buildSyntheticScenario } from "@ember/simulation";

vi.setConfig({ testTimeout: 600_000 });

// Long synchronous tests starve the worker's RPC channel; yield a macrotask between tests so it can flush.
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
});

describe("controller output is always valid for the simulator", () => {
  // One short test per variant and seed: a single multi-minute synchronous test starves the vitest worker's
  // RPC and fails the run with an unhandled timeout even when every assertion passes.
  for (const variant of VARIANTS) {
    ["rb-1", "rb-2", "rb-3", "rb-4"].forEach((seed, i) => {
      it(`${variant} ${seed}: no rejected plans, exclusive corridor, exact replay`, () => {
        const scenario = buildSyntheticScenario();
        const session = new IncidentSession({ scenario, seed, overrides: overridesForSeed(seed, i), factory: factoryFor(variant) });
        const policy = new ScriptedCoordinatorPolicy(session, scenario.map);
        while (!session.incident.ended && session.incident.simTimeMs < 600_000) {
          session.step();
          policy.tick();
          const onCorridor = session.incident.truth().agents.filter((a) => a.position.kind === "edge" && a.position.edgeId === "e-s-h" && a.state !== "lost");
          expect(onCorridor.length).toBeLessThanOrEqual(1);
        }
        const rejected = session.incident.notices.filter((n) => n.kind === "plan_rejected").map((n) => `${n.agentId}:${n.reason}`);
        expect(rejected).toEqual([]);
        expect(replayRecord(recordOf(session.incident)).hashMatches).toBe(true);
      });
    });
  }
});
