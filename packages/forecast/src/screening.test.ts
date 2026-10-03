import { describe, expect, it, vi } from "vitest";
import { AgentId } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { FireField, SIM_DEFAULTS, type FireParams } from "@ember/simulation/model";
import { forecastStep } from "./dynamics.js";
import { fitIgnition, fitMember, fitObservations } from "./fit.js";
import { rolloutContext, rolloutIgnition } from "./rollout.js";
import { ForecastService, briefingObservation, observeFire, snapshotOf } from "./index.js";
import type { ForecastParams } from "./types.js";

vi.setConfig({ testTimeout: 120_000 });

/**
 * Candidate screening and member building are the forecast's hot path: a candidate is rolled out
 * only as far as the evidence needs, and a passing one carries on to the horizon from that state.
 * These tests pin both shortcuts to a from-scratch rollout.
 */

const map = buildSyntheticScenario().map;
const STEP = 5000;
const truth: FireParams = { spreadMultiplier: 1.15, initialWindRad: 0.1, windShiftMs: 300_000, postShiftWindRad: 1.3 };
const watchers = [
  { agentId: "crew-1", x: 330, y: 1000 },
  { agentId: "scout", x: 900, y: 700 },
];

const asParams = (p: Partial<ForecastParams> & { spreadMultiplier: number }): ForecastParams => ({
  initialWindRad: 0,
  windShiftMs: 450_000,
  postShiftWindRad: 1,
  initialProgress: 0,
  ...p,
});

/** The original, unshortcut rollout: a fresh field stepped to `endMs`, converted as stored. */
function referenceRollout(params: ForecastParams, endMs: number): Float64Array {
  const ctx = rolloutContext(map);
  const field = new FireField(ctx.terrain, ctx.nonburnable);
  field.ignite(ctx.initialCells, 0, params.initialProgress ?? 0);
  for (let t = STEP; t <= endMs; t += STEP) forecastStep(field, t, STEP, params);
  return Float64Array.from(field.ignitedAtMs, (v) => (v === 0 || !Number.isFinite(v) ? v : Math.max(0, v - STEP)));
}

describe("partial-rollout fitting", () => {
  it("fitIgnition on a live field gives the same verdict as fitting its converted copy", () => {
    const obs = fitObservations(snapshotOf("crew-1", [briefingObservation(map), ...observeFire(map, truth, watchers, 420_000)], 420_000));
    expect(obs.length).toBeGreaterThan(20);
    const ctx = rolloutContext(map);
    let pass = 0;
    let fail = 0;
    for (const spread of [0.5, 0.9, 1.1, 1.15, 1.2, 1.6]) {
      const params = asParams({ spreadMultiplier: spread, initialWindRad: 0.1, windShiftMs: 300_000, postShiftWindRad: 1.3 });
      const field = new FireField(ctx.terrain, ctx.nonburnable);
      field.ignite(ctx.initialCells, 0, 0);
      let t = 0;
      for (const at of [100_000, 250_000, 420_000]) {
        while (t < at + STEP) {
          t += STEP;
          forecastStep(field, t, STEP, params);
        }
        const converted = Float64Array.from(field.ignitedAtMs, (v) => (v === 0 || !Number.isFinite(v) ? v : Math.max(0, v - STEP)));
        const upTo = obs.filter((o) => o.timeMs <= at);
        const copy = fitMember({ id: "m", kind: "sampled", params, ignitionMs: converted, rolloutEndMs: t }, upTo, 0.1);
        const live = fitIgnition(field.ignitedAtMs, STEP, upTo, 0.1);
        expect(live).toEqual(copy);
        if (copy.pass) pass += 1;
        else fail += 1;
      }
    }
    // Both verdicts occur, so the comparison is not vacuous.
    expect(pass).toBeGreaterThan(0);
    expect(fail).toBeGreaterThan(0);
  });
});

describe("warm-started rollouts", () => {
  it("continuing a screened field to the horizon equals rolling out from zero", () => {
    const ctx = rolloutContext(map);
    // Parameters nobody else uses, so the rollout cache cannot answer for them.
    for (const [i, spread] of [0.8123, 1.0471, 1.2899].entries()) {
      const params = asParams({ spreadMultiplier: spread, windShiftMs: 380_000 + i * 1000 });
      const field = new FireField(ctx.terrain, ctx.nonburnable);
      field.ignite(ctx.initialCells, 0, 0);
      let t = 0;
      while (t < 200_000 + STEP) {
        t += STEP;
        forecastStep(field, t, STEP, params);
      }
      const warm = rolloutIgnition(ctx, params, 1_800_000, STEP, false, { field, atMs: t, stepMs: STEP });
      expect(Array.from(warm)).toEqual(Array.from(referenceRollout(params, 3_300_000)));
    }
  });

  it("a warm start at the wrong step size is ignored rather than trusted", () => {
    const ctx = rolloutContext(map);
    const params = asParams({ spreadMultiplier: 0.9137 });
    const field = new FireField(ctx.terrain, ctx.nonburnable);
    field.ignite(ctx.initialCells, 0, 0);
    forecastStep(field, 2500, 2500, params);
    const got = rolloutIgnition(ctx, params, 1_800_000, STEP, false, { field, atMs: 2500, stepMs: 2500 });
    expect(Array.from(got)).toEqual(Array.from(referenceRollout(params, 3_300_000)));
  });
});

describe("an ensemble built through screening", () => {
  it("has members identical to from-scratch rollouts, all supported by the evidence", () => {
    // A late, sharp wind shift thins the prior so replenishment (screening, then warm rollout) runs.
    const evidence = [briefingObservation(map), ...observeFire(map, { ...truth, spreadMultiplier: 1.28, windShiftMs: 200_000 }, watchers, 360_000)];
    const snapshot = snapshotOf("crew-1", evidence, 360_000);
    const service = new ForecastService(AgentId.parse("crew-1"), map);
    service.update(snapshotOf("crew-1", [briefingObservation(map)], 0), 0);
    const ensemble = service.update(snapshot, 360_000);
    expect(ensemble.reliability).toBe("reliable");
    expect(ensemble.members.length).toBeGreaterThanOrEqual(8);
    expect(ensemble.members.some((m) => m.kind === "replenished"), "replenishment ran").toBe(true);
    const fit = fitObservations(snapshot);
    for (const member of ensemble.members) {
      expect(fitMember(member, fit, 0.1).pass, member.id).toBe(true);
      expect(Array.from(member.ignitionMs), member.id).toEqual(Array.from(referenceRollout(member.params, member.rolloutEndMs)));
    }
    expect(SIM_DEFAULTS.gridSize).toBe(64);
  });
});
