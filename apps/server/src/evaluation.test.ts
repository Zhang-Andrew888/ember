import { describe, expect, it, vi } from "vitest";
import { BundleReplayReader, serializeBundle, parseBundle } from "@ember/replay";
import { replayRecord } from "@ember/simulation";
import { HELD_OUT_SEEDS, VARIANTS, overridesForSeed, runEvaluation, runVariant } from "./evaluation.js";

vi.setConfig({ testTimeout: 300_000 });

const SHORT = 300_000;

describe("evaluation harness", () => {
  it("runs the same variant and seed to an identical result", () => {
    const a = runVariant({ variant: "ember_line", seed: "dev-1", untilMs: SHORT });
    const b = runVariant({ variant: "ember_line", seed: "dev-1", untilMs: SHORT });
    expect(a.bundle.record.finalSnapshotHash).toBe(b.bundle.record.finalSnapshotHash);
    expect(a.relays).toEqual(b.relays);
    const strip = (m: typeof a.metrics) => ({ ...m, replanLatencyMs: [] });
    expect(strip(a.metrics)).toEqual(strip(b.metrics));
  });

  it("shares one hidden fire trajectory across variants for the same seed", () => {
    const fires = VARIANTS.map((v) => {
      const r = runVariant({ variant: v, seed: "dev-2", untilMs: 120_000 });
      // Rebuild the truth from the record alone: only inputs differ between variants, never the fire.
      const replay = replayRecord(r.bundle.record);
      return Array.from(replay.incident.truth().cellState).join("");
    });
    expect(new Set(fires).size).toBe(1);
  });

  it("gives the dispatch baseline no forecast and the full planners a forecast, with the scout parked unless Ember Line", () => {
    const dispatch = runVariant({ variant: "dispatch", seed: "dev-3", untilMs: 60_000 });
    const noScout = runVariant({ variant: "forecast_no_scout", seed: "dev-3", untilMs: 60_000 });
    const ember = runVariant({ variant: "ember_line", seed: "dev-3", untilMs: 60_000 });
    const scoutDecisions = (r: typeof ember) => r.bundle.decisions.filter((d) => d.agentId === "scout").length;
    expect(scoutDecisions(dispatch)).toBe(0);
    expect(scoutDecisions(noScout)).toBe(0);
    expect(scoutDecisions(ember)).toBeGreaterThan(0);
    // The baseline admits missions with no forecast, so it commits at once.
    expect(dispatch.bundle.decisions.some((d) => d.type === "mission_start")).toBe(true);
  });

  it("replays a recorded bundle to the same final snapshot and view", async () => {
    const r = runVariant({ variant: "forecast_no_scout", seed: "dev-4", untilMs: SHORT });
    const round = parseBundle(serializeBundle(r.bundle));
    const verify = replayRecord(round.record);
    expect(verify.hashMatches).toBe(true);
    expect(verify.firstDivergenceMs).toBeNull();
    const view = await new BundleReplayReader(round).buildFinalView();
    expect(view.simTimeMs).toBe(round.record.finalTimeMs);
    let decisions = 0;
    for await (const e of new BundleReplayReader(round).readEvents()) if (e.kind === "decision") decisions += 1;
    expect(decisions).toBe(round.decisions.length);
  });

  it("logs every relay and never relays an agent's own observation back to it", () => {
    const r = runVariant({ variant: "ember_line", seed: "dev-5", untilMs: 400_000 });
    expect(r.bundle.policyLog).toHaveLength(r.metrics.relays);
    expect(r.bundle.policy).toEqual({ name: "scripted-relay", version: "1" });
    for (const relay of r.relays) {
      expect(relay.observationId.startsWith(`obs:${relay.toAgentId}:`)).toBe(false);
      expect(relay.tick % 1000).toBe(0);
    }
    // At most one relay per five simulated seconds.
    const ticks = r.relays.map((x) => x.tick);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(5000);
  });

  it("injects a sensor blackout and relay failures without breaking the run", () => {
    const base = runVariant({ variant: "ember_line", seed: "dev-1", untilMs: 200_000 });
    const faulted = runVariant({
      variant: "ember_line",
      seed: "dev-1",
      untilMs: 200_000,
      faults: [{ kind: "sensor_blackout", agentId: "crew-1", fromMs: 10_000, untilMs: 150_000 }, { kind: "relay_delay", ms: 10_000 }, { kind: "relay_drop_every", n: 2 }],
    });
    expect(faulted.bundle.record.inputs.some((i) => i.input.kind === "sensor_fault")).toBe(true);
    expect(base.bundle.record.inputs.some((i) => i.input.kind === "sensor_fault")).toBe(false);
    // A blacked-out sensor publishes nothing during the outage, then recovers.
    const replayed = replayRecord(faulted.bundle.record).incident.coordinator.observations().filter((o) => o.sourceAgentId === "crew-1");
    expect(replayed.some((o) => o.observedAt > 12_000 && o.observedAt < 150_000)).toBe(false);
    const clean = replayRecord(base.bundle.record).incident.coordinator.observations().filter((o) => o.sourceAgentId === "crew-1");
    expect(clean.some((o) => o.observedAt > 12_000 && o.observedAt < 150_000)).toBe(true);
    expect(replayRecord(faulted.bundle.record).hashMatches).toBe(true);
    expect(faulted.metrics.relays).toBeLessThanOrEqual(base.metrics.relays);
  });

  it("keeps the seed families and stress mix reproducible", () => {
    expect(HELD_OUT_SEEDS).toHaveLength(20);
    expect(new Set(HELD_OUT_SEEDS).size).toBe(20);
    expect(overridesForSeed("x", 0)).toEqual({ windShiftMs: 280_000 });
    expect(overridesForSeed("x", 1)).toEqual({ spreadMultiplier: 1.55 });
    expect(overridesForSeed("x", 2)).toEqual({});
  });

  it("produces a report with raw counts, caveats and no claimed advantage", () => {
    const report = runEvaluation({ seeds: ["heldout-01", "heldout-02"], untilMs: 120_000 });
    expect(report.variants.map((v) => v.variant)).toEqual([...VARIANTS]);
    expect(report.caveats.join(" ")).toMatch(/synthetic/i);
    for (const v of report.variants) {
      expect(v.summary.runs).toBe(2);
      expect(v.runs.every((r) => r.simSeconds <= 120)).toBe(true);
    }
    expect(report.scenarioHash).toMatch(/^[0-9a-f]{32}$/);
  });
});
