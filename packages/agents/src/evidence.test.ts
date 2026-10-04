import { describe, expect, it } from "vitest";
import { Observation } from "@ember/domain";
import { SIM_DEFAULTS } from "@ember/simulation/model";
import { buildSyntheticScenario } from "@ember/simulation";
import { EvidenceTracker } from "./evidence.js";

describe("EvidenceTracker.knownBurningCells", () => {
  const scenario = buildSyntheticScenario();
  const cell = 42;

  const obs = (id: string, at: number, state: "burning" | "burned" | "unburned") =>
    Observation.parse({
      id,
      sourceAgentId: "crew-1",
      observedAt: at,
      receivedAt: at,
      spatialFootprint: { centerX: 0, centerY: 0, radius: 100 },
      observedFields: [{ kind: "cell", gridCellIndex: cell, burnState: state }],
    });

  it("drops a cell after a newer burned sighting", () => {
    const t = new EvidenceTracker(scenario.map);
    t.ingest([obs("a", 100_000, "burning")]);
    expect(t.knownBurningCells(100_000)).toEqual([cell]);
    t.ingest([obs("a", 100_000, "burning"), obs("b", 150_000, "burned")]);
    expect(t.knownBurningCells(150_000)).toEqual([]);
  });

  it("ignores an older unburned relay after a local burning sighting", () => {
    const t = new EvidenceTracker(scenario.map);
    t.ingest([obs("local", 300_000, "burning")]);
    t.ingest([obs("local", 300_000, "burning"), obs("old-clear", 200_000, "unburned")]);
    expect(t.knownBurningCells(300_000)).toEqual([cell]);
    expect(t.closed.has(cell)).toBe(true);
  });

  it("expires burning sightings after the simulated burn duration", () => {
    const t = new EvidenceTracker(scenario.map);
    const at = 100_000;
    t.ingest([obs("a", at, "burning")]);
    const still = at + SIM_DEFAULTS.cellBurnMs;
    expect(t.knownBurningCells(still)).toEqual([cell]);
    expect(t.knownBurningCells(still + 1)).toEqual([]);
  });
});
