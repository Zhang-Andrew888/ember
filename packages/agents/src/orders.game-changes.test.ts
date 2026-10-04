import { describe, expect, it, vi } from "vitest";
import { AgentId, Objective, ObjectiveId, SequenceNumber, SiteId } from "@ember/domain";
import { Incident, buildSyntheticScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { CrewController, explain, runControllers } from "./index.js";

const crew1 = AgentId.parse("crew-1");
const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };
const farFire = cellIndexOf(1300, 300)!;

function order(objective: Record<string, unknown>) {
  const base = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"], gameChanges: true });
  const scenario = { ...base, map: { ...base.map, initialFireCells: [farFire] } };
  const inc = new Incident({ scenario, seed: "gc-orders", overrides: calm });
  const c = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: scenario.map, gameChanges: true });
  c.receiveObjective(
    Objective.parse({ ...objective, id: ObjectiveId.parse("obj-1"), recipientId: crew1, issueSequence: SequenceNumber.parse(1) }),
  );
  const submit = vi.spyOn(inc, "submit");
  const log = runControllers(inc, [c], 3000);
  const commits = submit.mock.calls.flatMap(([input]) => (input.kind === "commit_plan" ? [input] : []));
  const last = commits[commits.length - 1];
  return { plan: last?.plan, workSiteId: last?.workSiteId, log };
}

describe("game-changes coordinator orders", () => {
  it("protects an ordered building before any fire reaches it", () => {
    const { plan, workSiteId, log } = order({ kind: "protect_site", targetId: SiteId.parse("site-a"), constraints: {} });
    expect(log.decisions.some((d) => d.event.type === "objective_rejected")).toBe(false);
    expect(log.decisions.some((d) => d.event.reasonCode === "objective_accepted")).toBe(true);
    expect(workSiteId).toBe("site-a");
    // No drive back: the crew picks its next job from the building.
    expect(plan?.timedLegs.every((l) => l.departMs < plan.workInterval.startMs)).toBe(true);
  });

  it("treats a contain order as the report of fire the crew has not seen", () => {
    const { plan, log } = order({ kind: "contain_fire", targetId: String(farFire), constraints: { gridCellIndex: farFire } });
    expect(log.decisions.some((d) => d.event.type === "objective_rejected")).toBe(false);
    expect(plan?.work).toEqual({ kind: "suppress_fire", gridCellIndex: farFire });
  });
});

describe("refusal wording", () => {
  it("blames the margin only when the forecast margin is the reason", () => {
    const refuse = (reasonCode: string) => explain("Crew 1", { type: "objective_rejected", reasonCode, actualAction: "" });
    expect(refuse("forecast_leg_unsafe")).toMatch(/required margin/);
    expect(refuse("no_feasible_mission_in_model")).toMatch(/required margin/);
    expect(refuse("no_safe_directional_route")).toBe("Crew 1 cannot do that. Known fire or terrain blocks every way in that direction.");
    expect(refuse("no_unresolved_target")).not.toMatch(/margin/);
  });
});
