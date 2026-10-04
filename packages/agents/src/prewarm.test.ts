import { describe, expect, it, vi } from "vitest";
import { Observation, SequenceNumber } from "@ember/domain";
import { ForecastService, type ForecastEnsemble } from "@ember/forecast";
import { Incident, buildSyntheticScenario, osmMontclairScenario } from "@ember/simulation";
import { CrewController } from "./controller.js";

vi.setConfig({ testTimeout: 120_000 });

describe("initial forecast prewarming", () => {
  it.each(["synthetic", "OSM"])("preserves every tick output and full ensemble on %s", (name) => {
    const scenario = name === "OSM" ? osmMontclairScenario() : buildSyntheticScenario();
    const inc = new Incident({ scenario, seed: "prewarm" });
    const spec = scenario.agents[0]!;
    const make = () => new CrewController({ agentId: spec.id, callsign: spec.callsign, role: spec.role, map: scenario.map });
    const cold = make();
    const warm = make();
    const before = inc.snapshotHash();
    warm.prewarmForecast(inc.projectAgent(spec.id));
    warm.prewarmForecast(inc.projectAgent(spec.id));
    expect(inc.snapshotHash()).toBe(before);
    expect(warm.state).toBe("HOLDING");
    expect(warm.activePlanId).toBeNull();
    // Preparing does not expose a controller decision or consume its first forecast event.
    expect(warm.currentEnsemble).toBeNull();
    let previousWarm: ForecastEnsemble | null = null;
    let previousCold: ForecastEnsemble | null = null;
    while (inc.simTimeMs < 30_000) {
      const proj = inc.projectAgent(spec.id);
      const expected = cold.tick(proj);
      expect(warm.tick(proj)).toEqual(expected);
      if (warm.currentEnsemble !== previousWarm || cold.currentEnsemble !== previousCold) {
        expect(warm.currentEnsemble).toEqual(cold.currentEnsemble);
        previousWarm = warm.currentEnsemble;
        previousCold = cold.currentEnsemble;
      }
      for (const order of expected.orders) inc.submit(order);
      inc.advanceTo(inc.simTimeMs + 1000);
    }
  });

  it.each(["evidence", "time"])("discards prewarming when first-tick %s changes", (change) => {
    const scenario = buildSyntheticScenario({ agents: ["crew-1"] });
    const inc = new Incident({ scenario, seed: "stale-prewarm" });
    const spec = scenario.agents[0]!;
    const make = () => new CrewController({ agentId: spec.id, callsign: spec.callsign, role: spec.role, map: scenario.map });
    const cold = make();
    const warm = make();
    const initial = inc.projectAgent(spec.id);
    warm.prewarmForecast(initial);
    const proj = change === "time" ? { ...initial, simTimeMs: 1000 } : {
      ...initial,
      knowledge: {
        ...initial.knowledge,
        revision: SequenceNumber.parse(initial.knowledge.revision + 1),
        observations: [...initial.knowledge.observations, Observation.parse({
          ...initial.knowledge.observations[0]!, id: "new-fire-evidence",
          observedFields: [{ kind: "cell", gridCellIndex: 0, burnState: "burning" }],
        })],
      },
    };
    expect(warm.tick(proj)).toEqual(cold.tick(proj));
    expect(warm.currentEnsemble).toEqual(cold.currentEnsemble);
  });

  it("builds once before the tick and preserves contradiction events and rebuild scheduling", () => {
    const scenario = buildSyntheticScenario({ agents: ["crew-1"] });
    const inc = new Incident({ scenario, seed: "contradiction-prewarm" });
    const spec = scenario.agents[0]!;
    const initial = inc.projectAgent(spec.id);
    const proj = { ...initial, knowledge: { ...initial.knowledge, observations: [Observation.parse({
      ...initial.knowledge.observations[0]!, id: "contradiction",
      observedFields: [{ kind: "cell", gridCellIndex: 0, burnState: "burning" }],
    })] } };
    const make = () => new CrewController({ agentId: spec.id, callsign: spec.callsign, role: spec.role, map: scenario.map });
    const cold = make();
    const warm = make();
    const update = vi.spyOn(ForecastService.prototype, "update");
    try {
      warm.prewarmForecast(proj);
      warm.prewarmForecast(proj);
      expect(update).toHaveBeenCalledTimes(1);
      const out = cold.tick(proj);
      expect(out.forecastEvents.some((e) => e.kind === "contradiction")).toBe(true);
      expect(warm.tick(proj)).toEqual(out);
      expect(warm.currentEnsemble).toEqual(cold.currentEnsemble);
      const later = { ...proj, simTimeMs: 10_000 };
      expect(warm.tick(later)).toEqual(cold.tick(later));
      expect(warm.currentEnsemble).toEqual(cold.currentEnsemble);
    } finally {
      update.mockRestore();
    }
  });
});
