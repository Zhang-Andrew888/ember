import { describe, expect, it } from "vitest";
import {
  ContainmentWorkResult,
  CoordinatorView,
  DecisionEvent,
  DecisionType,
  EndReason,
  MissionPlan,
  MissionWork,
  Objective,
  ObjectiveKind,
} from "./index.js";

describe("issue #115 — containment contract", () => {
  it("ObjectiveKind includes contain_fire alongside protect_site", () => {
    expect(ObjectiveKind.options).toContain("protect_site");
    expect(ObjectiveKind.options).toContain("contain_fire");
    expect(ObjectiveKind.options).not.toContain("fire_extinguished");
  });

  it("parses a contain_fire objective with cell anchor and optional duration bounds", () => {
    const obj = Objective.parse({
      id: "obj-c",
      recipientId: "crew-1",
      kind: "contain_fire",
      targetId: "1100",
      constraints: {
        gridCellIndex: 1100,
        workInterval: { minMs: 60_000, maxMs: 120_000 },
      },
      issueSequence: 2,
    });
    expect(obj.kind).toBe("contain_fire");
    expect(obj.constraints.gridCellIndex).toBe(1100);
  });

  it("MissionWork distinguishes structure protection from fire suppression", () => {
    const structure = MissionWork.parse({ kind: "protect_structure", siteId: "site-a" });
    const suppress = MissionWork.parse({ kind: "suppress_fire", gridCellIndex: 42 });
    expect(structure.kind).toBe("protect_structure");
    expect(suppress.kind).toBe("suppress_fire");
    expect(structure.kind).not.toBe(suppress.kind);
  });

  it("MissionPlan carries work location, class, and duration via workInterval", () => {
    const plan = MissionPlan.parse({
      id: "plan-1",
      recipientId: "crew-1",
      knowledgeRevision: 0,
      timedLegs: [],
      workInterval: { startMs: 100_000, endMs: 160_000 },
      work: { kind: "suppress_fire", gridCellIndex: 1100 },
      refugeId: "n-rw",
      reservationRevision: 0,
      limitingReason: null,
    });
    expect(plan.work?.kind).toBe("suppress_fire");
    expect(plan.workInterval.endMs - plan.workInterval.startMs).toBe(60_000);
  });

  it("legacy MissionPlan without work still parses (structure protection via commit workSiteId)", () => {
    expect(() =>
      MissionPlan.parse({
        id: "plan-legacy",
        recipientId: "crew-1",
        knowledgeRevision: 0,
        timedLegs: [],
        workInterval: { startMs: 0, endMs: 30_000 },
        refugeId: "n-rw",
        reservationRevision: 0,
        limitingReason: null,
      }),
    ).not.toThrow();
  });

  it("EndReason fire_extinguished is incident-level, not a crew work or objective kind", () => {
    expect(EndReason.options).toContain("fire_extinguished");
    expect(ObjectiveKind.options).not.toContain("fire_extinguished");
    expect(
      MissionWork.safeParse({ kind: "fire_extinguished", gridCellIndex: 0 }).success,
    ).toBe(false);
  });

  it("safety rejection remains objective_rejected; containment failure is a separate decision", () => {
    expect(DecisionType.options).toContain("objective_rejected");
    expect(DecisionType.options).toContain("containment_failed");
    expect(DecisionType.options).toContain("containment_succeeded");

    const refused = DecisionEvent.parse({
      sequence: 1,
      tick: 10_000,
      agentId: "crew-1",
      type: "objective_rejected",
      reasonCode: "forecast_unreliable",
      evidenceIds: [],
      actualAction: "",
    });
    const failed = DecisionEvent.parse({
      sequence: 2,
      tick: 20_000,
      agentId: "crew-1",
      type: "containment_failed",
      reasonCode: "safety_refused",
      evidenceIds: [],
      actualAction: "containment aborted",
    });
    expect(refused.type).toBe("objective_rejected");
    expect(failed.type).toBe("containment_failed");
  });

  it("ContainmentWorkResult and CoordinatorView expose reportable success/failure", () => {
    const result = ContainmentWorkResult.parse({
      agentId: "crew-2",
      gridCellIndex: 99,
      outcome: "succeeded",
      reasonCode: "duration_elapsed",
      reportedAt: 90_000,
    });
    expect(result.outcome).toBe("succeeded");

    expect(() =>
      CoordinatorView.parse({
        protocolVersion: 1,
        sequence: 1,
        simTimeMs: 90_000,
        wallElapsedMs: 18_000,
        incidentStatus: "active",
        activeRecipientId: null,
        agents: [],
        sites: [],
        observedCells: [],
        agentPlans: [
          {
            agentId: "crew-2",
            planId: "plan-c",
            legs: [],
            workInterval: { startMs: 80_000, endMs: 100_000 },
            work: { kind: "suppress_fire", gridCellIndex: 99 },
            refugeId: "n-rw",
            phase: "work",
            limitingReason: null,
          },
        ],
        coordinatorForecast: null,
        recentReports: [],
        recentContainmentResults: [result],
        incidentEnd: null,
      }),
    ).not.toThrow();
  });
});
