import { z } from "zod";
import { AppliedInput } from "./inputs.js";
import { Incident } from "./incident.js";
import { SimScenario } from "./scenario.js";
import { SIM_DEFAULTS } from "./model/index.js";

export const RunRecord = z.object({
  format: z.literal("ember-run-record-v1"),
  scenario: SimScenario,
  seed: z.string(),
  overrides: z.object({
    spreadMultiplier: z.number().optional(),
    initialWindRad: z.number().optional(),
    windShiftMs: z.number().optional(),
    postShiftWindRad: z.number().optional(),
  }),
  inputs: z.array(AppliedInput),
  finalTimeMs: z.number().int().nonnegative(),
  finalSnapshotHash: z.string(),
  checkpoints: z.array(z.object({ timeMs: z.number().int(), hash: z.string() })),
  wallElapsedMs: z.number().int().nonnegative(),
  endReasons: z.array(z.string()),
});
export type RunRecord = z.infer<typeof RunRecord>;

/** Everything needed to reproduce a run: scenario, seed, and the ordered applied inputs. */
export function recordOf(incident: Incident): RunRecord {
  return RunRecord.parse({
    format: "ember-run-record-v1",
    scenario: incident.scenario,
    seed: incident.seed,
    overrides: Object.fromEntries(Object.entries(incident.overrides).filter(([, v]) => v !== undefined)),
    inputs: incident.inputLog,
    finalTimeMs: incident.simTimeMs,
    finalSnapshotHash: incident.snapshotHash(),
    checkpoints: incident.checkpoints,
    wallElapsedMs: incident.wallElapsedMs,
    endReasons: incident.end?.matchingReasons ?? [],
  });
}

export interface ReplayOutcome {
  readonly incident: Incident;
  readonly hashMatches: boolean;
  /** Sim time of the first checkpoint that differs from the record, or null. */
  readonly firstDivergenceMs: number | null;
}

/** Re-run a record from its inputs alone. No agent logic or provider is consulted. */
export function replayRecord(raw: RunRecord): ReplayOutcome {
  const record = RunRecord.parse(raw);
  const incident = new Incident({ scenario: record.scenario, seed: record.seed, overrides: record.overrides });
  const byTime = new Map<number, AppliedInput[]>();
  for (const applied of record.inputs) {
    const list = byTime.get(applied.appliedAtMs) ?? [];
    list.push(applied);
    byTime.set(applied.appliedAtMs, list);
  }
  while (!incident.ended && incident.simTimeMs < record.finalTimeMs) {
    const next = incident.simTimeMs + SIM_DEFAULTS.stepMs;
    for (const applied of (byTime.get(next) ?? []).sort((a, b) => a.ordinal - b.ordinal)) {
      incident.submit(applied.input);
    }
    incident.advanceTo(next);
  }
  let firstDivergenceMs: number | null = null;
  for (const expected of record.checkpoints) {
    const got = incident.checkpoints.find((c) => c.timeMs === expected.timeMs);
    if (got === undefined || got.hash !== expected.hash) {
      firstDivergenceMs = expected.timeMs;
      break;
    }
  }
  return {
    incident,
    hashMatches: incident.snapshotHash() === record.finalSnapshotHash,
    firstDivergenceMs,
  };
}
