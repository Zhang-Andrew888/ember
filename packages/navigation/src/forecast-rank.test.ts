import { describe, expect, it } from "vitest";
import { AgentId, NodeId } from "@ember/domain";
import { rankedIgnitionMs } from "@ember/forecast";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, cellIndexOf } from "@ember/simulation/model";
import { HazardModel, certifyPlan, firelineTarget, lineForecastMemberRank, planMissions, type PlanningContext } from "./index.js";
import { DEFAULT_NAV_CONFIG } from "./types.js";
import { makeEnsemble } from "./testing.js";

const scenario = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] });
const road = new RoadIndex(scenario.map);
const J1 = NodeId.parse("n-j1");
const j1Cell = cellIndexOf(400, 800)!;

/** 24 members; member i reaches the J1 work node at (i + 1) minutes. */
const ensemble = makeEnsemble(
  scenario.map,
  Array.from({ length: 24 }, (_, i) => ({ id: `m${i}`, ignition: new Map([[j1Cell, (i + 1) * 60_000]]) })),
);

describe("ranked forecast ignition", () => {
  it("takes the n-th earliest member per cell, clamped to the ensemble", () => {
    expect(rankedIgnitionMs(ensemble, 1)[j1Cell]).toBe(60_000);
    expect(rankedIgnitionMs(ensemble, 6)[j1Cell]).toBe(360_000);
    expect(rankedIgnitionMs(ensemble, 99)[j1Cell]).toBe(24 * 60_000);
    expect(rankedIgnitionMs(ensemble, 6)[j1Cell + 1]).toBe(Infinity);
  });

  it("uses the 6th of 24 members for fire lines, scaled for other ensemble sizes", () => {
    expect(lineForecastMemberRank(24)).toBe(6);
    expect(lineForecastMemberRank(12)).toBe(3);
    expect(lineForecastMemberRank(2)).toBe(1);
    expect(lineForecastMemberRank(0)).toBe(1);
  });

  it("still closes directly observed fire whatever the rank", () => {
    const hm = new HazardModel(road, ensemble, new Set([j1Cell]), DEFAULT_NAV_CONFIG, ensemble.members, 6);
    expect(hm.cellIgnMs(j1Cell)).toBe(-Infinity);
  });
});

describe("fire line planning against the 6th earliest member", () => {
  const planned = firelineTarget(road, { x: 400, y: 800 }, { x: 1000, y: 800 });
  if (!planned.ok) throw new Error("J1 is on the road");
  const ctx: PlanningContext = {
    agentId: AgentId.parse("crew-1"),
    road,
    closedCells: new Set(),
    position: { kind: "node", nodeId: J1 },
    nowMs: 0,
    ensemble,
    diagnose: false,
  };
  const longest = (rank: number): number => {
    const result = planMissions({ ...ctx, forecastMemberRank: rank }, [planned.target]);
    return Math.max(0, ...result.candidates.map((c) => c.workMs));
  };

  it("admits a longer shift than planning against the earliest member", () => {
    expect(longest(6)).toBeGreaterThan(longest(1));
  });

  it("certifies the plan at the rank it was made with, not against the earliest member", () => {
    const result = planMissions({ ...ctx, forecastMemberRank: 6 }, [planned.target]);
    const plan = [...result.candidates].sort((a, b) => b.workMs - a.workMs)[0]!.plan;
    const input = { road, ensemble, closedCells: new Set<number>(), plan, position: ctx.position, legIndex: 0, nowMs: 0 };
    expect(certifyPlan({ ...input, forecastMemberRank: 6 }).ok).toBe(true);
    expect(certifyPlan(input).ok).toBe(false);
  });
});
