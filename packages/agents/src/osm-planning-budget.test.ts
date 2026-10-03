import { describe, expect, it, vi } from "vitest";
import { AgentId } from "@ember/domain";
import type { MissionSearchResult, PlanningContext } from "@ember/navigation";
import { Incident, osmMontclairScenario } from "@ember/simulation";
import { CrewController, ScoutController, type ControllerOptions } from "./index.js";

vi.setConfig({ testTimeout: 300_000 });

// Host clock, present in Node and in vitest. This package's tsconfig has no DOM/Node lib, so declare
// only what is used. It is measurement only: nothing in the simulation reads wall time.
declare const performance: { now(): number };

/** docs/VALIDATION.md: scoped forecast + replan p95 under 500 ms. */
const REPLAN_TARGET_MS = 500;
/** Loud-failure caps well above the target, so a slow CI machine does not flake but a regression does. */
const REPLAN_CAP_MS = 1_500;
const COLD_TICK_CAP_MS = 1_500;
/** Covers the cold plan, many replans, the earliest wind shift and the forecast contradictions after it. */
const RUN_MS = 520_000;

const planning: number[] = [];

/** Times every mission search (the planner's whole cost, excluding the forecast). */
class TimedCrew extends CrewController {
  override candidateSearch(ctx: PlanningContext, allowed: ReadonlySet<string> | null): MissionSearchResult {
    const t0 = performance.now();
    const result = super.candidateSearch(ctx, allowed);
    planning.push(performance.now() - t0);
    return result;
  }
}

class TimedScout extends ScoutController {
  override candidateSearch(ctx: PlanningContext, allowed: ReadonlySet<string> | null): MissionSearchResult {
    const t0 = performance.now();
    const result = super.candidateSearch(ctx, allowed);
    planning.push(performance.now() - t0);
    return result;
  }
}

const percentile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};

describe("OSM Montclair planning budget (issue #72)", () => {
  it("plans within the documented replan target through the real controllers", () => {
    const scenario = osmMontclairScenario();
    const inc = new Incident({ scenario, seed: "osm-budget", overrides: { spreadMultiplier: 1, windShiftMs: 450_000, initialWindRad: 0 } });
    const controllers = scenario.agents.map((a) => {
      const options: ControllerOptions = { agentId: AgentId.parse(a.id), callsign: a.id, role: a.id === "scout" ? "scout" : "protection_crew", map: scenario.map };
      return a.id === "scout" ? new TimedScout(options) : new TimedCrew(options);
    });

    const planningTicks: number[] = [];
    let firstTick = Infinity;
    let first = true;
    while (!inc.ended && inc.simTimeMs < RUN_MS) {
      for (const c of controllers) {
        const searches = planning.length;
        const t0 = performance.now();
        const out = c.tick(inc.projectAgent(c.agentId));
        const wall = performance.now() - t0;
        for (const order of out.orders) inc.submit(order);
        if (first) firstTick = wall;
        first = false;
        // A tick that planned also paid for any forecast refresh it triggered: the target's "scoped forecast + replan".
        if (planning.length > searches) planningTicks.push(wall);
      }
      inc.advanceTo(inc.simTimeMs + 1000);
    }

    expect(inc.simTimeMs, "the run must complete, not stall").toBeGreaterThanOrEqual(RUN_MS);
    expect(planning.length, "enough replans to be meaningful").toBeGreaterThan(20);
    const summary =
      `planning ms: p50 ${percentile(planning, 0.5).toFixed(1)}, p95 ${percentile(planning, 0.95).toFixed(1)}, max ${Math.max(...planning).toFixed(0)}; ` +
      `planning-tick ms: p95 ${percentile(planningTicks, 0.95).toFixed(1)}, max ${Math.max(...planningTicks).toFixed(0)}; first tick ${firstTick.toFixed(0)}`;
    expect(percentile(planning, 0.95), summary).toBeLessThan(REPLAN_TARGET_MS);
    expect(Math.max(...planning), summary).toBeLessThan(REPLAN_CAP_MS);
    expect(percentile(planningTicks, 0.95), summary).toBeLessThan(REPLAN_TARGET_MS);
    expect(firstTick, summary).toBeLessThan(COLD_TICK_CAP_MS);
  });
});
