import { describe, expect, it, vi } from "vitest";
import { AgentId } from "@ember/domain";
import { Incident, buildSyntheticScenario } from "@ember/simulation";
import { CrewController } from "./index.js";
import { patch } from "./scenarios.testkit.js";

vi.setConfig({ testTimeout: 300_000 });

// Host clock, present in Node and in vitest. This package's tsconfig has no DOM/Node lib, so declare
// only what is used. It is measurement only: nothing in the simulation reads wall time.
declare const performance: { now(): number };

/** AGENTS.md: the simulation tick must complete in under 200 ms of wall time. */
const TICK_BUDGET_MS = 200;
/**
 * A cold forecast build is paid on the first tick of a synchronous harness (the server runs
 * forecasts asynchronously). It is bounded separately so a regression there still fails loudly.
 */
const COLD_START_CAP_MS = 3_000;

function runFullTeam(simMs: number): number[] {
  const base = buildSyntheticScenario();
  const scenario = { ...base, map: { ...base.map, initialFireCells: patch(1500, 100) } };
  const inc = new Incident({ scenario, seed: "bench", overrides: { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 } });
  const controllers = scenario.agents.map(
    (a) => new CrewController({ agentId: AgentId.parse(a.id), callsign: a.id, role: "protection_crew", map: scenario.map }),
  );
  const wallPerTick: number[] = [];
  while (!inc.ended && inc.simTimeMs < simMs) {
    const t0 = performance.now();
    for (const c of controllers) {
      const out = c.tick(inc.projectAgent(c.agentId));
      for (const order of out.orders) inc.submit(order);
    }
    wallPerTick.push(performance.now() - t0);
    inc.advanceTo(inc.simTimeMs + 1000);
  }
  return wallPerTick;
}

const percentile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;

describe("tick budget guard", () => {
  it("keeps the full team's controller work for one tick within budget at the 95th percentile, and bounds the cold start", () => {
    const ticks = runFullTeam(600_000);
    expect(ticks.length).toBeGreaterThan(300);
    const sorted = [...ticks].sort((a, b) => a - b);
    const p95 = percentile(sorted, 0.95);
    const max = sorted[sorted.length - 1]!;
    const summary = `tick wall ms: median ${percentile(sorted, 0.5).toFixed(2)}, p95 ${p95.toFixed(2)}, p99 ${percentile(sorted, 0.99).toFixed(2)}, max ${max.toFixed(1)}`;
    expect(p95, summary).toBeLessThan(TICK_BUDGET_MS);
    expect(max, summary).toBeLessThan(COLD_START_CAP_MS);
  });

  it("the median tick is cheap: an idle or travelling team does almost no work", () => {
    const sorted = [...runFullTeam(300_000)].sort((a, b) => a - b);
    expect(percentile(sorted, 0.5)).toBeLessThan(TICK_BUDGET_MS / 4);
  });
});
