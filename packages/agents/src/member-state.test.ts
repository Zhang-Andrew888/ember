import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_CONFIG } from "@ember/navigation";
import { FATIGUE_PER_MIN, FRESH_MEMBER_STATE, advanceMemberState, parseMemberState, tightenNav } from "./member-state.js";

const attrs = FATIGUE_PER_MIN.protection_crew;

describe("member state", () => {
  it("starts fresh and validates ranges", () => {
    expect(parseMemberState(FRESH_MEMBER_STATE)).toEqual(FRESH_MEMBER_STATE);
    expect(() => parseMemberState({ ...FRESH_MEMBER_STATE, fatigue: 1.5 })).toThrow(RangeError);
    expect(() => parseMemberState({ ...FRESH_MEMBER_STATE, morale: -0.1 })).toThrow(RangeError);
    expect(() => parseMemberState({ ...FRESH_MEMBER_STATE, fatigue: Number.NaN })).toThrow(RangeError);
    expect(() => parseMemberState(null)).toThrow(RangeError);
  });

  it("has no injury state: only fatigue and morale exist (docs/SIMULATION.md: no injury meter)", () => {
    expect(Object.keys(FRESH_MEMBER_STATE).sort()).toEqual(["fatigue", "morale"]);
    const hot = advanceMemberState(FRESH_MEMBER_STATE, attrs, { dtMs: 600_000, activity: "emergency" });
    expect(Object.keys(hot).sort()).toEqual(["fatigue", "morale"]);
    expect(Object.keys(parseMemberState({ fatigue: 0.1, morale: 0.9, injuryRisk: 0.5 })).sort()).toEqual(["fatigue", "morale"]);
  });

  it("fresh state leaves planning config unchanged", () => {
    expect(tightenNav(DEFAULT_NAV_CONFIG, FRESH_MEMBER_STATE)).toEqual(DEFAULT_NAV_CONFIG);
  });

  it("fatigue grows with duty time, faster when working, and recovers at a refuge", () => {
    const worked = advanceMemberState(FRESH_MEMBER_STATE, attrs, { dtMs: 120_000, activity: "working" });
    const moved = advanceMemberState(FRESH_MEMBER_STATE, attrs, { dtMs: 120_000, activity: "travelling" });
    expect(worked.fatigue).toBeGreaterThan(moved.fatigue);
    expect(moved.fatigue).toBeGreaterThan(0);
    const rested = advanceMemberState(worked, attrs, { dtMs: 120_000, activity: "resting" });
    expect(rested.fatigue).toBeLessThan(worked.fatigue);
  });

  it("emergency exposure lowers morale and raises fatigue faster; rest recovers morale only slowly", () => {
    const hot = advanceMemberState(FRESH_MEMBER_STATE, attrs, { dtMs: 60_000, activity: "emergency" });
    const moved = advanceMemberState(FRESH_MEMBER_STATE, attrs, { dtMs: 60_000, activity: "travelling" });
    expect(hot.morale).toBeLessThan(1);
    expect(hot.fatigue).toBeGreaterThan(moved.fatigue);
    const rested = advanceMemberState(hot, attrs, { dtMs: 60_000, activity: "resting" });
    expect(rested.morale).toBeGreaterThanOrEqual(hot.morale);
    expect(1 - rested.morale).toBeGreaterThan(0.5 * (1 - hot.morale));
  });

  it("is deterministic and keeps every value inside [0, 1]", () => {
    let a = FRESH_MEMBER_STATE;
    let b = FRESH_MEMBER_STATE;
    for (let i = 0; i < 200; i++) {
      const activity = (["working", "travelling", "emergency", "resting"] as const)[i % 4]!;
      a = advanceMemberState(a, attrs, { dtMs: 37_000, activity });
      b = advanceMemberState(b, attrs, { dtMs: 37_000, activity });
      for (const v of [a.fatigue, a.morale]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(a).toEqual(b);
  });

  it("ignores non-positive time steps", () => {
    expect(advanceMemberState(FRESH_MEMBER_STATE, attrs, { dtMs: 0, activity: "working" })).toEqual(FRESH_MEMBER_STATE);
    expect(advanceMemberState(FRESH_MEMBER_STATE, attrs, { dtMs: -5, activity: "working" })).toEqual(FRESH_MEMBER_STATE);
  });
});

describe("feasibility tightening is monotone and never loosens", () => {
  const levels = [0, 0.25, 0.5, 0.75, 1];
  it("each factor alone only tightens", () => {
    for (const v of levels) {
      const tired = tightenNav(DEFAULT_NAV_CONFIG, { ...FRESH_MEMBER_STATE, fatigue: v });
      expect(tired.bufferMs).toBeGreaterThanOrEqual(DEFAULT_NAV_CONFIG.bufferMs);
      expect(tired.speedMps).toBeLessThanOrEqual(DEFAULT_NAV_CONFIG.speedMps);
      expect(tired.crewWorkRate).toBeLessThanOrEqual(DEFAULT_NAV_CONFIG.crewWorkRate);
      expect(tired.crewWorkRate).toBeGreaterThan(0);
      const nav = tightenNav(DEFAULT_NAV_CONFIG, { ...FRESH_MEMBER_STATE, morale: 1 - v });
      expect(nav.bufferMs).toBeGreaterThanOrEqual(DEFAULT_NAV_CONFIG.bufferMs);
      expect(nav.speedMps).toBeLessThanOrEqual(DEFAULT_NAV_CONFIG.speedMps);
    }
  });

  it("is monotone in every component over a grid", () => {
    for (const f of levels) for (const m of levels) {
      const s = { fatigue: f, morale: m };
      const base = tightenNav(DEFAULT_NAV_CONFIG, s);
      for (const worse of [{ ...s, fatigue: Math.min(1, f + 0.25) }, { ...s, morale: Math.max(0, m - 0.25) }]) {
        const w = tightenNav(DEFAULT_NAV_CONFIG, worse);
        expect(w.bufferMs).toBeGreaterThanOrEqual(base.bufferMs);
        expect(w.speedMps).toBeLessThanOrEqual(base.speedMps);
        expect(w.crewWorkRate).toBeLessThanOrEqual(base.crewWorkRate);
      }
    }
  });

  it("leaves a rested member's planning unchanged and tightens a strained one", () => {
    expect(tightenNav(DEFAULT_NAV_CONFIG, { fatigue: 0.2, morale: 0.9 })).toEqual(DEFAULT_NAV_CONFIG);
    const strained = tightenNav(DEFAULT_NAV_CONFIG, { fatigue: 0.9, morale: 1 });
    expect(strained.bufferMs).toBeGreaterThan(DEFAULT_NAV_CONFIG.bufferMs);
    expect(strained.speedMps).toBeLessThan(DEFAULT_NAV_CONFIG.speedMps);
    expect(tightenNav(DEFAULT_NAV_CONFIG, { fatigue: 0, morale: 0.2 }).bufferMs).toBeGreaterThan(DEFAULT_NAV_CONFIG.bufferMs);
  });

  it("never loosens a larger base buffer or a slower base speed", () => {
    const base = { ...DEFAULT_NAV_CONFIG, bufferMs: 90_000, speedMps: 2 };
    const nav = tightenNav(base, { fatigue: 0.9, morale: 0.5 });
    expect(nav.bufferMs).toBeGreaterThanOrEqual(90_000);
    expect(nav.speedMps).toBeLessThanOrEqual(2);
  });
});
