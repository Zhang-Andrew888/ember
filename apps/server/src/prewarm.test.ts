import { describe, expect, it, vi } from "vitest";
import { ForecastService } from "@ember/forecast";
import { buildSyntheticScenario, osmMontclairScenario } from "@ember/simulation";
import { LiveRun } from "./hub.js";
import { IncidentRegistry } from "./incident-registry.js";
import { IncidentSession } from "./session.js";
import { startServer } from "./ws-server.js";

vi.setConfig({ testTimeout: 120_000 });

describe("session forecast prewarming", () => {
  it.each(["synthetic", "OSM"])("preserves the %s team, reservations, observations and coordinator views", (name) => {
    const scenario = name === "OSM" ? osmMontclairScenario() : buildSyntheticScenario();
    const make = () => new IncidentSession({ scenario, seed: "warm-team" });
    const cold = make();
    const warm = make();
    const hash = warm.incident.snapshotHash();
    const observations = warm.incident.coordinator.observations();
    warm.prewarmForecasts();
    warm.prewarmForecasts();
    expect(warm.incident.snapshotHash()).toBe(hash);
    expect(warm.incident.simTimeMs).toBe(0);
    expect(warm.incident.inputLog).toHaveLength(0);
    expect(warm.incident.coordinator.observations()).toEqual(observations);
    expect(warm.decisions).toHaveLength(0);
    expect(warm.controllerMs).toHaveLength(0);
    expect(warm.reservations.revision).toBe(cold.reservations.revision);
    expect(warm.coordinatorView()).toEqual(cold.coordinatorView());
    for (let i = 0; i < 30; i++) {
      cold.step();
      warm.step();
      expect(warm.decisions).toEqual(cold.decisions);
      expect(warm.incident.inputLog).toEqual(cold.incident.inputLog);
      expect(warm.reservations.revision).toBe(cold.reservations.revision);
      expect(warm.coordinatorView()).toEqual(cold.coordinatorView());
    }
    expect(warm.incident.snapshotHash()).toBe(cold.incident.snapshotHash());
  });

  it("discards a coordinator warm-up if its first view comes after time advances", () => {
    const make = () => new IncidentSession({ scenario: buildSyntheticScenario(), seed: "delayed-view", uncontrolled: ["crew-1", "crew-2", "crew-3"] });
    const cold = make();
    const warm = make();
    warm.prewarmForecasts();
    cold.step();
    warm.step();
    expect(warm.coordinatorView()).toEqual(cold.coordinatorView());
  });

  it.each(["registry", "standalone"])("builds crew and coordinator forecasts before the %s live clock starts", async (creation) => {
    const update = ForecastService.prototype.update;
    const builds: string[] = [];
    const spy = vi.spyOn(ForecastService.prototype, "update").mockImplementation(function (this: ForecastService, snapshot, now) {
      if (this.current === null) builds.push(this.agentId);
      return update.call(this, snapshot, now);
    });
    const start = LiveRun.prototype.start;
    const startSpy = vi.spyOn(LiveRun.prototype, "start").mockImplementation(function (this: LiveRun) {
      expect(builds).toHaveLength(4);
      start.call(this);
    });
    let close: (() => Promise<void>) | undefined;
    try {
      const scenario = buildSyntheticScenario();
      const registry = new IncidentRegistry("warm-path");
      const record = creation === "registry" ? registry.create({ scenario }, { nowMs: () => 50_000 }) : null;
      const server = creation === "standalone" ? await startServer({ scenario, seed: "warm-path" }) : null;
      close = server?.close;
      const session = (record?.session ?? server?.session)!;
      expect(builds).toEqual([...scenario.agents.map((a) => a.id), "coordinator"]);
      if (record !== null) registry.start(record);
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(session.incident.simTimeMs).toBe(0);
      session.coordinatorView();
      session.step();
      expect(builds).toHaveLength(4);
    } finally {
      await close?.();
      spy.mockRestore();
      startSpy.mockRestore();
    }
  });
});
