import { describe, expect, it, vi } from "vitest";
import { osmMontclairScenario } from "@ember/simulation";
import { IncidentSession } from "./session.js";

vi.setConfig({ testTimeout: 300_000 });

const percentile = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};

/** A whole-team regression guard, in addition to the per-controller planning budget. */
describe("OSM team startup and planning budget (#72)", () => {
  it("moves forecast startup before live time and keeps team ticks within budget through the wind shift", () => {
    const scenario = osmMontclairScenario();
    const coldStartup: number[] = [];
    const warmStartup: number[] = [];
    const preparation: number[] = [];
    const teamTicks: number[] = [];
    for (const seed of ["osm-budget", "osm-startup-2", "osm-startup-3"]) {
      const make = () => new IncidentSession({ scenario, seed, overrides: { spreadMultiplier: 1, windShiftMs: 450_000, initialWindRad: 0 } });
      const cold = make();
      let start = performance.now();
      cold.step();
      coldStartup.push(performance.now() - start);
      const warm = make();
      start = performance.now();
      warm.prewarmForecasts();
      preparation.push(performance.now() - start);
      // The coordinator's briefing is also built before live time.
      warm.coordinatorView();
      start = performance.now();
      warm.step();
      warmStartup.push(performance.now() - start);
      expect(warm.decisions).toEqual(cold.decisions);
      expect(warm.incident.snapshotHash()).toBe(cold.incident.snapshotHash());
      // Include one complete incident to cover the later evidence-heavy rebuild spikes too.
      const endMs = seed === "osm-budget" ? 1_500_000 : 520_000;
      warm.runUntil(endMs);
      expect(warm.incident.simTimeMs).toBe(endMs);
      teamTicks.push(...warm.controllerMs);
    }
    const summary = {
      coldStartupMs: coldStartup.map(Math.round),
      warmStartupMs: warmStartup.map(Math.round),
      preparationMs: preparation.map(Math.round),
      teamP95Ms: percentile(teamTicks, 0.95),
      teamP99Ms: percentile(teamTicks, 0.99),
      teamMaxMs: Math.max(...teamTicks),
      secondsOver200Ms: teamTicks.filter((ms) => ms > 200).length,
    };
    if (process.env.EMBER_PROFILE_STARTUP === "1") process.stdout.write(`${JSON.stringify(summary)}\n`);
    const detail = JSON.stringify(summary);
    expect(Math.max(...warmStartup), detail).toBeLessThan(500);
    // Prewarming targets startup, not the occasional later synchronous rebuild. Track those
    // separately and allow CI headroom on the maximum rather than promising zero backlog.
    expect(percentile(teamTicks, 0.95), detail).toBeLessThan(200);
    expect(Math.max(...teamTicks), detail).toBeLessThan(1500);
  });
});
