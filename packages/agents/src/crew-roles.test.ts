import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_CONFIG } from "@ember/navigation";
import { SIM_DEFAULTS } from "@ember/simulation/model";
import { CREW_KINDS, CREW_PROFILES, CrewAttributes, defaultKindForRole, domainRoleOf, navConfigFor, profileOf } from "./crew-roles.js";

describe("crew roles and capabilities", () => {
  it("defines engine, hand crew and scout with valid typed attributes", () => {
    expect([...CREW_KINDS].sort()).toEqual(["engine", "hand_crew", "scout"]);
    for (const kind of CREW_KINDS) {
      expect(CrewAttributes.safeParse(CREW_PROFILES[kind].attributes).success).toBe(true);
    }
  });

  it("rejects non-positive or non-finite attributes", () => {
    const ok = CREW_PROFILES.engine.attributes;
    expect(CrewAttributes.safeParse({ ...ok, speedMps: 0 }).success).toBe(false);
    expect(CrewAttributes.safeParse({ ...ok, workRate: -1 }).success).toBe(false);
    expect(CrewAttributes.safeParse({ ...ok, fatiguePerMin: Number.NaN }).success).toBe(false);
    expect(CrewAttributes.safeParse({ ...ok, carryingCapacity: Infinity }).success).toBe(false);
    expect(CrewAttributes.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("distinguishes the kinds: engine is fast, hand crew works longest, scout does not protect", () => {
    const e = CREW_PROFILES.engine.attributes;
    const h = CREW_PROFILES.hand_crew.attributes;
    const s = CREW_PROFILES.scout.attributes;
    expect(e.speedMps).toBeGreaterThan(h.speedMps);
    expect(e.carryingCapacity).toBeGreaterThan(h.carryingCapacity);
    expect(s.workRate).toBe(0);
    expect(h.fatiguePerMin).toBeLessThan(e.fatiguePerMin);
  });

  it("maps every kind to a domain role", () => {
    expect(domainRoleOf("engine")).toBe("protection_crew");
    expect(domainRoleOf("hand_crew")).toBe("protection_crew");
    expect(domainRoleOf("scout")).toBe("scout");
    expect(defaultKindForRole("protection_crew")).toBe("engine");
    expect(defaultKindForRole("scout")).toBe("scout");
    expect(profileOf("hand_crew").kind).toBe("hand_crew");
  });

  it("derives planning config that never plans faster or more productive than the simulator delivers", () => {
    for (const kind of CREW_KINDS) {
      const nav = navConfigFor(kind);
      expect(nav.speedMps).toBeLessThanOrEqual(SIM_DEFAULTS.agentSpeedMps);
      expect(nav.speedMps).toBeGreaterThan(0);
      expect(nav.crewWorkRate).toBeLessThanOrEqual(SIM_DEFAULTS.crewWorkRate);
      expect(nav.bufferMs).toBeGreaterThanOrEqual(DEFAULT_NAV_CONFIG.bufferMs);
    }
  });

  it("never loosens a buffer supplied in the base config", () => {
    const base = { ...DEFAULT_NAV_CONFIG, bufferMs: 90_000 };
    expect(navConfigFor("engine", base).bufferMs).toBe(90_000);
    expect(navConfigFor("hand_crew", { ...base, bufferMs: 10_000 }).bufferMs).toBeGreaterThanOrEqual(10_000);
  });

  it("keeps a scout's work rate non-zero in planning so dwell time is never divided by zero", () => {
    expect(navConfigFor("scout").crewWorkRate).toBeGreaterThan(0);
  });
});
