import { describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, SimTimeMs } from "@ember/domain";
import { buildSyntheticScenario, type AgentProjection } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { KnowledgeStore } from "@ember/knowledge";
import { briefingObservation } from "@ember/forecast";
import { cellOnEdge, cellsOfEdge, makeEnsemble, type PlanningContext } from "@ember/navigation";
import { ScoutController, edgeImportance } from "./index.js";

vi.setConfig({ testTimeout: 120_000 });

const scenario = buildSyntheticScenario({ agents: ["scout"], sites: ["site-a", "site-b", "site-c"] });
const map = scenario.map;
const road = new RoadIndex(map);
const scoutId = AgentId.parse("scout");

function ctxWith(ensemble: ReturnType<typeof makeEnsemble>, nowMs = 0): PlanningContext {
  return {
    agentId: scoutId,
    road,
    ensemble,
    closedCells: new Set(),
    position: { kind: "node", nodeId: NodeId.parse("n-rs") },
    nowMs,
    diagnose: false,
  };
}

function scout(): ScoutController {
  return new ScoutController({ agentId: scoutId, callsign: "Scout", role: "scout", map });
}

describe("public site-access importance", () => {
  it("counts the site value that loses or lengthens access when an edge is lost", () => {
    const imp = edgeImportance(road);
    expect(imp.get("e-s-h")).toBeCloseTo(2.5, 9); // Ridge Cabins and Waterworks both route through it; the Lodge has its own road
    expect(imp.get("e-h-sa")).toBeCloseTo(1, 9); // only Ridge Cabins loses access
    expect(imp.get("e-n-h")).toBe(0); // the north road is only a spare
  });
});

describe("information-driven scout choice", () => {
  const member = (id: string, edges: string[], at: number) => ({
    id,
    ignition: new Map(edges.flatMap((e) => cellsOfEdge(road, e).filter((c) => (road.edgesByCell.get(c) ?? []).length === 1).map((c) => [c, at] as [number, number]))),
  });

  it("goes where retained futures disagree about an important corridor", () => {
    // Members split on whether the corridor closes soon; the north road is unanimous.
    const ensemble = makeEnsemble(map, [member("a", ["e-s-h"], 60_000), member("b", [], 0), member("c", ["e-n-h"], 60_000), member("d", ["e-n-h"], 60_000)]);
    const result = scout().candidateSearch(ctxWith(ensemble), null);
    expect(result.feasible).toBe(true);
    expect(["n-s", "n-h"]).toContain(result.best?.target.id);
    expect(result.best?.plan.workInterval.endMs).toBe(result.best!.plan.workInterval.startMs + 10_000);
  });

  it("ignores disagreement about a corridor that matters little for site access", () => {
    const split = makeEnsemble(map, [member("a", ["e-n-h"], 60_000), member("b", [], 0)]);
    const calm = makeEnsemble(map, [member("a", [], 0), member("b", [], 0)]);
    const s = scout();
    const scoreSplit = s.candidateSearch(ctxWith(split), null).best!.score;
    const scoreCalm = s.candidateSearch(ctxWith(calm), null).best!.score;
    expect(scoreSplit).toBeCloseTo(scoreCalm, 6);
  });

  it("rests a recently observed point for 60 s unless new fire evidence arrived", () => {
    const ensemble = makeEnsemble(map, [member("a", ["e-s-h"], 60_000), member("b", [], 0)]);
    const s = scout();
    const store = new KnowledgeStore(scoutId);
    store.ingest(briefingObservation(map));
    const proj = (now: number, working: boolean): AgentProjection => ({
      agentId: scoutId,
      simTimeMs: now,
      role: "scout",
      callsign: "Scout",
      position: { kind: "node", nodeId: NodeId.parse("n-s") },
      state: working ? "working" : "idle",
      objectiveRevision: 0,
      planRevision: 1,
      knowledgeRevision: store.revision,
      commitment: working ? { planId: "p", legIndex: 1, legCount: 2, mode: "normal", working: true } : null,
      knowledge: store.snapshot(SimTimeMs.parse(now)),
      inputHash: store.inputHash(),
    });
    s.tick(proj(100_000, true));
    const early = s.candidateSearch(ctxWith(ensemble, 110_000), null);
    expect(early.candidates.every((c) => c.target.id !== "n-s")).toBe(true);
    const later = s.candidateSearch(ctxWith(ensemble, 170_000), null);
    expect(later.candidates.some((c) => c.target.id === "n-s")).toBe(true);
    // A coordinator objective may send it back immediately.
    const forced = s.candidateSearch(ctxWith(ensemble, 110_000), new Set(["n-s"]));
    expect(forced.feasible).toBe(true);
    expect(cellOnEdge(road, "e-s-h", 0.5)).toBeGreaterThan(0);
  });

  it("is rejected from the same admission rules as a crew when the forecast is unreliable", () => {
    const ensemble = makeEnsemble(map, [member("a", [], 0)], { reliability: "unreliable" });
    expect(scout().candidateSearch(ctxWith(ensemble), null).limitingReason).toBe("forecast_unreliable");
  });
});
