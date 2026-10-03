import { describe, expect, it } from "vitest";
import { DecisionType, ObjectiveKind, AgentId } from "@ember/domain";
import type { ControllerState } from "./types.js";
import { CrewController } from "./controller.js";
import { buildSyntheticScenario } from "@ember/simulation";

const CONTROLLER_STATES: ControllerState[] = [
  "HOLDING",
  "PLANNING",
  "APPROACHING",
  "WORKING",
  "RETURNING",
  "WITHDRAWING",
  "RETREATING",
  "STRANDED",
  "LOST",
];

describe("contract issue #3 — agent controller vs domain", () => {
  it("ControllerState is richer than domain AgentState", () => {
    expect(CONTROLLER_STATES).toContain("RETURNING");
    expect(CONTROLLER_STATES).toContain("STRANDED");
    expect(CONTROLLER_STATES).toContain("PLANNING");
  });

  it("resumeAutonomous is a controller API, not an ObjectiveKind", () => {
    const scenario = buildSyntheticScenario();
    const controller = new CrewController({
      agentId: AgentId.parse("crew-1"),
      callsign: "Crew 1",
      role: "protection_crew",
      map: scenario.map,
    });
    expect(typeof controller.resumeAutonomous).toBe("function");
    controller.resumeAutonomous();
    expect(ObjectiveKind.options).not.toContain("resume_autonomous");
  });

  it("forecast contradiction/rebuild stay on TickOutput.forecastEvents, not DecisionEvent", () => {
    // Documented contract gap #5: DecisionType has no matching codes.
    expect(DecisionType.options.some((t) => t.includes("forecast"))).toBe(false);
  });
});
