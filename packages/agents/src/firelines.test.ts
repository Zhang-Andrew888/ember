import { describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, Objective, ObjectiveId, SequenceNumber } from "@ember/domain";
import { Incident, buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { RoadIndex, cellIndexOf, firelineCells, firelineId } from "@ember/simulation/model";
import { firelineTarget } from "@ember/navigation";
import { CrewController, runControllers } from "./index.js";

// Full simulated runs and cold forecast rollouts are slow on shared CI machines.
vi.setConfig({ testTimeout: 120_000 });

const crew1 = AgentId.parse("crew-1");
const RW = NodeId.parse("n-rw");
const J1 = NodeId.parse("n-j1");
const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };

function farFireScenario(): SimScenario {
  const base = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] });
  return { ...base, map: { ...base.map, initialFireCells: [cellIndexOf(30, 1500)!, cellIndexOf(55, 1500)!] } };
}

const lineObjective = (from: NodeId, to: NodeId, id = "obj-line"): Objective =>
  Objective.parse({
    id: ObjectiveId.parse(id),
    recipientId: crew1,
    kind: "build_line",
    targetId: null,
    constraints: { line: { fromNodeId: from, toNodeId: to } },
    issueSequence: SequenceNumber.parse(1),
  });

describe("fire line target", () => {
  it("plans enough work to clear every reachable cell from the crew's end", () => {
    const road = new RoadIndex(farFireScenario().map);
    const target = firelineTarget(road, RW, J1);
    expect(target?.kind).toBe("line");
    expect(target?.nodeId).toBe(RW);
    const cells = firelineCells(road, RW, J1).length;
    expect(target?.workOptionsMs.at(-1)).toBe(cells * 15_000);
  });
});

describe("fire line objectives", () => {
  it("cuts the ordered line, names both ends in plain words, then resumes on its own", () => {
    const scenario = farFireScenario();
    const inc = new Incident({ scenario, seed: "line-order", overrides: calm });
    const c = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: scenario.map });
    c.receiveObjective(lineObjective(RW, J1));
    const log = runControllers(inc, [c], 300_000);
    const accepted = log.decisions.find((d) => d.event.reasonCode === "objective_accepted");
    expect(accepted?.event.actualAction).toMatch(/cutting a fire line from Refuge West toward West Junction/);
    const view = inc.projectCoordinator();
    expect(view.firelines?.[0]?.id).toBe(firelineId(RW, J1));
    expect(view.firebreakCells?.length ?? 0).toBeGreaterThan(5);
    // One shift per order: after the mission the crew no longer holds the objective.
    expect(c.status(inc.projectAgent(crew1)).objective).toBeNull();
  });

  it("refuses a line order that names no line", () => {
    const scenario = farFireScenario();
    const inc = new Incident({ scenario, seed: "line-missing", overrides: calm });
    const c = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: scenario.map });
    c.receiveObjective(lineObjective(RW, NodeId.parse("n-nowhere")));
    const log = runControllers(inc, [c], 2_000);
    expect(log.decisions.find((d) => d.event.type === "objective_rejected")?.event.reasonCode).toBe("missing_target");
  });
});
