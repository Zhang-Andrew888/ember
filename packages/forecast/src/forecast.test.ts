import { describe, expect, it } from "vitest";
import { buildSyntheticScenario } from "@ember/simulation";
import { SIM_DEFAULTS, cellIndexOf, type FireParams } from "@ember/simulation/model";
import {
  DEFAULT_FORECAST_CONFIG,
  ForecastService,
  admitsProtection,
  briefingObservation,
  burnFractionAt,
  earliestIgnitionMs,
  fitMember,
  fitObservations,
  observeFire,
  rolloutContext,
  rolloutIgnition,
  snapshotOf,
} from "./index.js";
import { AgentId } from "@ember/domain";

const map = buildSyntheticScenario().map;
const inPrior: FireParams = { spreadMultiplier: 1, initialWindRad: 0, windShiftMs: 550_000, postShiftWindRad: 1.2 };
const watcher = { agentId: "crew-1", x: 330, y: 1000 };
const agent = AgentId.parse("crew-1");

function evidence(truth: FireParams, untilMs: number, observers = [watcher]) {
  return [briefingObservation(map), ...observeFire(map, truth, observers, untilMs)];
}

describe("prior ensemble", () => {
  it("has 24 members including boundary and no-shift cases and is deterministic", () => {
    const snap = snapshotOf("crew-1", [briefingObservation(map)], 0);
    const a = new ForecastService(agent, map).update(snap, 0);
    const b = new ForecastService(agent, map).update(snap, 0);
    expect(a.members).toHaveLength(24);
    expect(a.reliability).toBe("reliable");
    expect(a.members.filter((m) => m.kind === "boundary")).toHaveLength(8);
    expect(a.members.filter((m) => m.kind === "no_shift").length).toBeGreaterThanOrEqual(3);
    expect(a.members.map((m) => m.id)).toEqual(b.members.map((m) => m.id));
    for (const m of a.members) {
      expect(m.params.spreadMultiplier).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(m.params.spreadMultiplier).toBeLessThanOrEqual(1.3 + 1e-9);
    }
    expect(a.horizonEndMs).toBe(DEFAULT_FORECAST_CONFIG.horizonMs);
  });

  it("rolls out per-cell ignition times, with the briefed patch at time zero", () => {
    const ctx = rolloutContext(map);
    const ign = rolloutIgnition(ctx, { ...inPrior, initialProgress: 0 }, 600_000, 5000);
    for (const c of map.initialFireCells) expect(ign[c]).toBe(0);
    const east = map.initialFireCells[1]! + 3;
    expect(ign[east]).toBeGreaterThan(0);
    expect(Number.isFinite(ign[east]!)).toBe(true);
    expect(rolloutIgnition(ctx, { ...inPrior, initialProgress: 0 }, 600_000, 5000)).toBe(ign);
  });
});

describe("fitting to evidence", () => {
  const obs = evidence(inPrior, 120_000);
  const fit = fitObservations(snapshotOf("crew-1", obs, 120_000));
  const ctx = rolloutContext(map);
  const member = (p: FireParams) => ({ id: "m", kind: "sampled" as const, params: p, ignitionMs: rolloutIgnition(ctx, p, 600_000, 5000), rolloutEndMs: 600_000 });

  it("supports a hypothesis matching the observed fire", () => {
    expect(fitMember(member({ ...inPrior, initialProgress: 0 }), fit, 0.1).pass).toBe(true);
  });

  it("rejects a hypothesis that spreads far too slowly or fast", () => {
    expect(fitMember(member({ ...inPrior, spreadMultiplier: 0.3, initialProgress: 0 }), fit, 0.1).pass).toBe(false);
    expect(fitMember(member({ ...inPrior, spreadMultiplier: 2.4, initialProgress: 0 }), fit, 0.1).pass).toBe(false);
  });

  it("skips cells an observer never reported instead of treating them as clear", () => {
    const only = fitObservations(snapshotOf("crew-1", [briefingObservation(map)], 0));
    expect(only).toHaveLength(1);
    expect(only[0]?.cells.length).toBe(4);
  });
});

describe("forecast service", () => {
  it("keeps boundary members that stay consistent and refills to 24 by perturbation", () => {
    const snap = snapshotOf("crew-1", evidence(inPrior, 120_000), 120_000);
    const e = new ForecastService(agent, map).update(snap, 120_000);
    expect(e.reliability).toBe("reliable");
    expect(e.members.length).toBeGreaterThan(0);
    expect(e.members.length).toBeLessThanOrEqual(24);
    expect(e.members.some((m) => m.kind === "replenished") || e.members.length === 24).toBe(true);
    for (const m of e.members) expect(fitMember(m, fitObservations(snap), 0.1).pass).toBe(true);
  });

  it("does not treat an old 'clear' report as current clearance", () => {
    // Observer sees the road cell to the east unburned at t=10 s; later it burns in most futures.
    const early = evidence(inPrior, 10_000);
    const snap = snapshotOf("crew-1", early, 10_000);
    const e = new ForecastService(agent, map).update(snap, 10_000);
    const cell = cellIndexOf(430, 1000)!;
    const earliest = earliestIgnitionMs(e)[cell]!;
    expect(e.members).toHaveLength(24);
    expect(earliest).toBeGreaterThan(10_000);
    expect(earliest).toBeLessThan(400_000);
    // After 100 s the same cell may be burning in some members; no member was dropped for it.
    expect(burnFractionAt(e, 400_000)[cell]).toBeGreaterThan(0);
  });

  it("is not changed by a coordinator-only observation", () => {
    const crewSnap = snapshotOf("crew-1", evidence(inPrior, 60_000), 60_000);
    const withScout = [...evidence(inPrior, 60_000), ...observeFire(map, inPrior, [{ agentId: "scout", x: 330, y: 1000 }], 60_000)];
    const coordinatorSnap = snapshotOf("coordinator", withScout, 60_000);
    const crewA = new ForecastService(agent, map).update(crewSnap, 60_000);
    const crewB = new ForecastService(agent, map).update(crewSnap, 60_000);
    expect(crewA.inputHash).toBe(crewB.inputHash);
    expect(crewA.members.map((m) => m.id)).toEqual(crewB.members.map((m) => m.id));
    const coord = new ForecastService(AgentId.parse("coordinator"), map).update(coordinatorSnap, 60_000);
    expect(coord.inputHash).not.toBe(crewA.inputHash);
  });

  it("admits no protection work from an empty or contradicted ensemble and explains why", () => {
    const fast: FireParams = { ...inPrior, spreadMultiplier: 2.4 };
    const snap = snapshotOf("crew-1", evidence(fast, 100_000), 100_000);
    const service = new ForecastService(agent, map);
    const e = service.update(snap, 100_000);
    expect(e.reliability).toBe("unreliable");
    expect(e.members).toHaveLength(0);
    expect(e.provisional.length).toBeGreaterThan(0);
    expect(admitsProtection(e)).toBe(false);
    expect(admitsProtection(null)).toBe(false);
    const event = service.events.find((x) => x.kind === "contradiction");
    expect(event?.explanation).toMatch(/UNRELIABLE/);
    expect(event && "observationIds" in event ? event.observationIds.length : 0).toBeGreaterThan(0);
    expect(service.needsRebuild(snap)).toBe(true);
  });

  it("recovers by widening ranges and records the ranges and observation ids", () => {
    const fast: FireParams = { ...inPrior, spreadMultiplier: 1.55 };
    const snap = snapshotOf("crew-1", evidence(fast, 100_000), 100_000);
    const service = new ForecastService(agent, map, { ...DEFAULT_FORECAST_CONFIG, rebuildCandidates: 40 });
    service.update(snap, 100_000);
    const rebuilt = service.rebuild(snap, 100_000);
    expect(rebuilt.reliability).toBe("reliable");
    expect(rebuilt.widenFactor).toBeGreaterThanOrEqual(2);
    expect(rebuilt.members.length).toBeGreaterThanOrEqual(8);
    expect(admitsProtection(rebuilt)).toBe(true);
    const done = service.events.find((e) => e.kind === "rebuild_complete");
    expect(done).toBeDefined();
    if (done?.kind === "rebuild_complete") {
      expect(done.ranges.spreadMultiplier.max).toBeGreaterThan(1.3);
      expect(done.observationIds.length).toBeGreaterThan(0);
      expect(done.supportedCount).toBeGreaterThanOrEqual(8);
    }
    expect(service.needsRebuild(snap)).toBe(false);
  });

  it("stays unreliable when no widening explains the evidence, and admits nothing", () => {
    // A burning cell far from the patch within seconds is impossible under the game model.
    const impossible = [
      briefingObservation(map),
      ...observeFire(map, inPrior, [watcher], 10_000),
      ...observeFire(map, { ...inPrior, spreadMultiplier: 2.5 }, [{ agentId: "crew-1", x: 900, y: 1300 }], 0).map((o) => ({
        ...o,
        id: o.id.replace("obs:", "obs:far:") as typeof o.id,
        observedAt: 8000 as typeof o.observedAt,
        observedFields: [{ kind: "cell" as const, edgeId: o.observedFields[0]!.kind === "cell" ? o.observedFields[0]!.edgeId : ("grid" as never), cellIndex: cellIndexOf(900, 1300)!, burnState: "burning" as const }],
      })),
    ];
    const snap = snapshotOf("crew-1", impossible, 10_000);
    const service = new ForecastService(agent, map, { ...DEFAULT_FORECAST_CONFIG, rebuildCandidates: 24 });
    service.update(snap, 10_000);
    const rebuilt = service.rebuild(snap, 10_000);
    expect(rebuilt.reliability).toBe("unreliable");
    expect(admitsProtection(rebuilt)).toBe(false);
    expect(service.events.some((e) => e.kind === "rebuild_failed")).toBe(true);
  });

  it("caches by scoped input hash within the refresh interval", () => {
    const snap = snapshotOf("crew-1", evidence(inPrior, 30_000), 30_000);
    const service = new ForecastService(agent, map);
    const a = service.update(snap, 30_000);
    expect(service.update(snap, 40_000)).toBe(a);
    expect(service.update(snap, 30_000 + DEFAULT_FORECAST_CONFIG.refreshMs)).not.toBe(a);
    expect(SIM_DEFAULTS.gridSize).toBe(64);
  });
});
