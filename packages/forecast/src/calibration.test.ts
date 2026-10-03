import { describe, expect, it } from "vitest";
import { AgentId } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex, streamRng } from "@ember/simulation/model";
import { arrivalCoverage, calibrateArrivalPadding, type ArrivalCalibrationCase } from "./calibration.js";
import { DEFAULT_FORECAST_CONFIG } from "./config.js";
import { edgeArrivalBands } from "./coordinator-projection.js";
import { rolloutContext, rolloutIgnition } from "./rollout.js";
import { ForecastService } from "./service.js";
import { briefingObservation, snapshotOf } from "./testing.js";

describe("arrival band calibration", () => {
  it("rejects structurally missing bands instead of inventing finite padding", () => {
    expect(() => calibrateArrivalPadding([{ earliestMs: null, latestMs: null, truthMs: 100 }])).toThrow(RangeError);
  });

  it("uses disjoint calibration and held-out truth seeds", () => {
    const map = buildSyntheticScenario().map;
    const road = new RoadIndex(map);
    const config = { ...DEFAULT_FORECAST_CONFIG, arrivalPaddingMs: 0 };
    const ensemble = new ForecastService(AgentId.parse("coordinator"), map, config)
      .update(snapshotOf("coordinator", [briefingObservation(map)], 0), 0);
    const bands = new Map(edgeArrivalBands(ensemble, road, 0).map((band) => [band.edgeId, band]));
    const ctx = rolloutContext(map);
    const calibrationSeeds = ["cal-01", "cal-02", "cal-03", "cal-04"];
    const heldOutSeeds = ["held-11", "held-12", "held-13", "held-14"];
    expect(calibrationSeeds.some((seed) => heldOutSeeds.includes(seed))).toBe(false);

    const cases = (seeds: readonly string[]): ArrivalCalibrationCase[] => seeds.flatMap((seed) => {
      const rng = streamRng(seed, "truth");
      const params = {
        spreadMultiplier: rng.range(0.65, 1.4),
        initialWindRad: rng.range(-0.7, 0.7),
        windShiftMs: Math.round(rng.range(450_000, 650_000) / 1000) * 1000,
        postShiftWindRad: rng.range(0.8, 1.6),
        moistureMultiplier: rng.range(0.75, 1.3),
        spotDistanceCells: rng.next() < 0.4 ? 7 : 0,
        spotTimeMs: 450_000,
      };
      const ignition = rolloutIgnition(ctx, params, config.horizonMs, 2000, true);
      const out: ArrivalCalibrationCase[] = [];
      for (const edge of road.edges.values()) {
        const truth = Math.min(...edge.cells.map((cell) => ignition[cell.cell] ?? Infinity));
        if (!Number.isFinite(truth) || truth > config.horizonMs) continue;
        const band = bands.get(edge.id)!;
        out.push({ earliestMs: band.earliestIgnitionMs, latestMs: band.latestIgnitionMs, truthMs: truth });
      }
      return out;
    });

    const training = cases(calibrationSeeds);
    const heldOut = cases(heldOutSeeds);
    const padding = calibrateArrivalPadding(training, 0.9);
    const measured = arrivalCoverage(heldOut, padding);
    expect(training.length).toBe(38);
    expect(heldOut.length).toBe(36);
    expect(padding).toBe(DEFAULT_FORECAST_CONFIG.arrivalPaddingMs);
    expect(arrivalCoverage(training, padding)).toBeCloseTo(35 / 38);
    expect(measured).toBe(1);
  });
});
