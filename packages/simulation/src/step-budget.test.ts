import { describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, SiteId } from "@ember/domain";
import { Incident, SIM_DEFAULTS, authoredCommit, buildSyntheticScenario, scenarioHash, type PrivateOverrides } from "./index.js";
import { RoadIndex } from "./model/index.js";

vi.setConfig({ testTimeout: 120_000 });

// Host clock, present in Node and in vitest. This package's tsconfig has no DOM/Node lib, so declare
// only what is used. It is measurement only: nothing in the simulation reads wall time.
declare const performance: { now(): number };

/** docs/VALIDATION.md: authoritative step work p95 under 20 ms. AGENTS.md: a tick never exceeds 200 ms. */
const P95_BUDGET_MS = 20;
const HARD_LIMIT_MS = 200;

const percentile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;

/** Wall time of every authoritative one-second step of a full incident with the crews working. */
function stepTimes(seed: string, overrides: PrivateOverrides): number[] {
  const scenario = buildSyntheticScenario();
  const inc = new Incident({ scenario, seed, overrides });
  const road = new RoadIndex(scenario.map);
  for (const a of scenario.agents.filter((agent) => agent.role === "protection_crew")) {
    const west = a.startNodeId === "n-rw";
    inc.submit(
      authoredCommit({
        road,
        agentId: AgentId.parse(a.id),
        planId: `bench-${a.id}`,
        knowledgeRevision: inc.agentRevision(AgentId.parse(a.id)),
        startNode: NodeId.parse(a.startNodeId),
        departMs: 0,
        approach: west ? ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"] : ["e-rs-sc"],
        workSiteId: SiteId.parse(west ? "site-a" : "site-c"),
        workMs: 200_000,
        back: [],
      }),
    );
  }
  const times: number[] = [];
  while (!inc.ended && inc.simTimeMs < SIM_DEFAULTS.incidentHorizonMs) {
    const t0 = performance.now();
    inc.advanceTo(inc.simTimeMs + SIM_DEFAULTS.stepMs);
    times.push(performance.now() - t0);
  }
  return times;
}

const WORST_CASE = { spreadMultiplier: 1.6, windShiftMs: 250_000, initialWindRad: 0 };

describe("authoritative step budget", () => {
  it("keeps p95 step work under 20 ms and never reaches 200 ms, even at the fastest spread", () => {
    const sorted = [...stepTimes("budget-fast", WORST_CASE)].sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThan(300);
    const p95 = percentile(sorted, 0.95);
    const max = sorted[sorted.length - 1]!;
    const summary = `step wall ms: median ${percentile(sorted, 0.5).toFixed(3)}, p95 ${p95.toFixed(3)}, p99 ${percentile(sorted, 0.99).toFixed(3)}, max ${max.toFixed(2)} (scenario ${scenarioHash(buildSyntheticScenario()).slice(0, 12)})`;
    expect(p95, summary).toBeLessThan(P95_BUDGET_MS);
    expect(max, summary).toBeLessThan(HARD_LIMIT_MS);
  });

  it("holds for the slowest spread and a late wind shift too", () => {
    const sorted = [...stepTimes("budget-slow", { spreadMultiplier: 0.6, windShiftMs: 650_000, initialWindRad: 0 })].sort((a, b) => a - b);
    expect(percentile(sorted, 0.95)).toBeLessThan(P95_BUDGET_MS);
    expect(sorted[sorted.length - 1]!).toBeLessThan(HARD_LIMIT_MS);
  });
});
