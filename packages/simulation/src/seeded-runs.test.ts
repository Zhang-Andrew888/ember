import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, SiteId } from "@ember/domain";
import {
  Incident,
  SIM_DEFAULTS,
  authoredCommit,
  buildSyntheticScenario,
  derivePrivateParameters,
  recordOf,
  replayRecord,
  type PrivateOverrides,
} from "./index.js";
import { RoadIndex } from "./model/index.js";

vi.setConfig({ testTimeout: 120_000 });

const crew1 = AgentId.parse("crew-1");

/** Seeds shaped like the evaluation sets: ordinary, earlier wind shift, wider spread rate. */
const CASES: { seed: string; overrides: PrivateOverrides }[] = [
  { seed: "showcase", overrides: {} },
  { seed: "dev-1", overrides: {} },
  { seed: "dev-2", overrides: {} },
  { seed: "held-early-shift", overrides: { windShiftMs: 250_000 } },
  { seed: "held-wide-spread", overrides: { spreadMultiplier: 1.6 } },
  { seed: "held-slow", overrides: { spreadMultiplier: 0.6, windShiftMs: 650_000 } },
];

function play(seed: string, overrides: PrivateOverrides): Incident {
  const scenario = buildSyntheticScenario();
  const inc = new Incident({ scenario, seed, overrides });
  inc.submit(
    authoredCommit({
      road: new RoadIndex(scenario.map),
      agentId: crew1,
      planId: "plan-1",
      knowledgeRevision: inc.agentRevision(crew1),
      startNode: NodeId.parse("n-rw"),
      departMs: 0,
      approach: ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"],
      workSiteId: SiteId.parse("site-a"),
      workMs: 300_000,
      back: ["e-h-sa", "e-s-h", "e-j1-s", "e-rw-j1"],
    }),
  );
  inc.advanceTo(SIM_DEFAULTS.incidentHorizonMs);
  return inc;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seeded private parameters", () => {
  it("are pinned for known seeds, so a change to the streams or ranges is noticed", () => {
    const golden = derivePrivateParameters("golden-1");
    expect(golden.spreadMultiplier).toBeCloseTo(1.2366144097, 9);
    expect(golden.initialWindRad).toBeCloseTo(0.022492734, 9);
    expect(golden.windShiftMs).toBe(488_000);
    expect(golden.postShiftWindRad).toBeCloseTo(0.8439665015, 9);
    const other = derivePrivateParameters("golden-2");
    expect(other.spreadMultiplier).toBeCloseTo(0.7646783135, 9);
    expect(other.windShiftMs).toBe(601_000);
  });

  it("stay inside the documented ranges for many seeds and are stable per seed", () => {
    const d = SIM_DEFAULTS;
    const jitter = (d.initialWindJitterDeg * Math.PI) / 180;
    for (let i = 0; i < 200; i++) {
      const p = derivePrivateParameters(`range-${i}`);
      expect(p).toEqual(derivePrivateParameters(`range-${i}`));
      expect(p.spreadMultiplier).toBeGreaterThanOrEqual(d.spreadMultiplierRange[0]);
      expect(p.spreadMultiplier).toBeLessThanOrEqual(d.spreadMultiplierRange[1]);
      expect(p.windShiftMs % 1000).toBe(0);
      expect(p.windShiftMs).toBeGreaterThanOrEqual(d.windShiftTimeRangeMs[0] - 500);
      expect(p.windShiftMs).toBeLessThanOrEqual(d.windShiftTimeRangeMs[1] + 500);
      expect(Math.abs(p.initialWindRad)).toBeLessThanOrEqual(jitter);
      expect(p.postShiftWindRad).toBeGreaterThanOrEqual((d.postShiftRangeDeg[0] * Math.PI) / 180);
      expect(p.postShiftWindRad).toBeLessThanOrEqual((d.postShiftRangeDeg[1] * Math.PI) / 180);
    }
  });

  it("overriding one parameter leaves the others from the same seed untouched", () => {
    const base = derivePrivateParameters("independent");
    const fast = derivePrivateParameters("independent", { spreadMultiplier: 1.6 });
    expect(fast.spreadMultiplier).toBe(1.6);
    expect({ ...fast, spreadMultiplier: base.spreadMultiplier }).toEqual(base);
  });
});

describe("reproducible seeded runs", () => {
  for (const { seed, overrides } of CASES) {
    it(`two independent runs agree at every checkpoint and replay exactly (${seed})`, () => {
      const a = play(seed, overrides);
      const b = play(seed, overrides);
      expect(a.checkpoints.length).toBeGreaterThan(0);
      expect(b.checkpoints).toEqual(a.checkpoints);
      expect(b.snapshotHash()).toBe(a.snapshotHash());
      const replayed = replayRecord(recordOf(a));
      expect(replayed.hashMatches).toBe(true);
      expect(replayed.firstDivergenceMs).toBeNull();
    });
  }

  it("gives different worlds for different seeds", () => {
    const hashes = new Set(CASES.slice(0, 3).map((c) => play(c.seed, c.overrides).snapshotHash()));
    expect(hashes.size).toBe(3);
  });

  it("reads neither wall time nor ambient randomness while running or replaying", () => {
    const reference = play("entropy", {}).snapshotHash();
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random is not allowed in the simulation");
    });
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now is not allowed in the simulation");
    });
    const inc = play("entropy", {});
    expect(inc.snapshotHash()).toBe(reference);
    expect(replayRecord(recordOf(inc)).hashMatches).toBe(true);
  });
});
