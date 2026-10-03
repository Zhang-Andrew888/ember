import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_CONFIG } from "@ember/navigation";
import { SIM_DEFAULTS } from "@ember/simulation/model";
import { CREW_CAPABILITIES, capabilitiesOf } from "./crew-roles.js";

describe("per-role capabilities", () => {
  it("match the documented simulator defaults for a protection crew", () => {
    expect(capabilitiesOf("protection_crew")).toEqual({ speedMps: SIM_DEFAULTS.agentSpeedMps, workRate: SIM_DEFAULTS.crewWorkRate });
  });

  it("agree with the planner's defaults so planning never assumes more than the simulator delivers", () => {
    const crew = CREW_CAPABILITIES.protection_crew;
    expect(crew.speedMps).toBeLessThanOrEqual(DEFAULT_NAV_CONFIG.speedMps);
    expect(crew.workRate).toBeLessThanOrEqual(DEFAULT_NAV_CONFIG.crewWorkRate);
  });

  it("a scout moves like a crew but does not protect", () => {
    expect(CREW_CAPABILITIES.scout.speedMps).toBe(CREW_CAPABILITIES.protection_crew.speedMps);
    expect(CREW_CAPABILITIES.scout.workRate).toBe(0);
  });

  it("covers exactly the wire roles with finite non-negative attributes", () => {
    expect(Object.keys(CREW_CAPABILITIES).sort()).toEqual(["protection_crew", "scout"]);
    for (const c of Object.values(CREW_CAPABILITIES)) {
      expect(Number.isFinite(c.speedMps) && c.speedMps > 0).toBe(true);
      expect(Number.isFinite(c.workRate) && c.workRate >= 0).toBe(true);
    }
  });
});
