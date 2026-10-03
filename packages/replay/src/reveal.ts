import { Incident, RunRecord, SIM_DEFAULTS } from "@ember/simulation";

export interface FireFrame {
  readonly timeMs: number;
  readonly burning: readonly number[];
  readonly burned: readonly number[];
}

export interface FireReveal {
  readonly frames: readonly FireFrame[];
  /** First ignition time per grid cell in ms; Infinity if it never ignited. */
  readonly ignitedAtMs: Float64Array;
  readonly finalSnapshotHash: string;
}

/**
 * The only place the full fire becomes visible: re-run a saved record (no providers, no
 * agent logic) and sample the truth. Live projections never carry this data.
 */
export function revealFire(rawRecord: RunRecord, frameEveryMs = 10_000): FireReveal {
  const record = RunRecord.parse(rawRecord);
  const incident = new Incident({ scenario: record.scenario, seed: record.seed, overrides: record.overrides });
  const byTime = new Map<number, RunRecord["inputs"]>();
  for (const applied of record.inputs) byTime.set(applied.appliedAtMs, [...(byTime.get(applied.appliedAtMs) ?? []), applied]);
  const frames: FireFrame[] = [];
  const capture = (): void => {
    const truth = incident.truth();
    const burning: number[] = [];
    const burned: number[] = [];
    for (let i = 0; i < truth.cellState.length; i++) {
      if (truth.cellState[i] === 2) burning.push(i);
      else if (truth.cellState[i] === 3) burned.push(i);
    }
    frames.push({ timeMs: truth.timeMs, burning, burned });
  };
  capture();
  while (!incident.ended && incident.simTimeMs < record.finalTimeMs) {
    const next = incident.simTimeMs + SIM_DEFAULTS.stepMs;
    for (const applied of (byTime.get(next) ?? []).sort((a, b) => a.ordinal - b.ordinal)) incident.submit(applied.input);
    incident.advanceTo(next);
    if (incident.simTimeMs % frameEveryMs === 0) capture();
  }
  return {
    frames,
    ignitedAtMs: incident.truth().cellIgnitedAtMs,
    finalSnapshotHash: incident.snapshotHash(),
  };
}
