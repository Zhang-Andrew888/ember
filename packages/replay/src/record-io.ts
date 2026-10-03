import { canonicalJson, replayRecord, RunRecord, type ReplayOutcome } from "@ember/simulation";

/** Stable text form of a run record: scenario, seed, overrides and the ordered applied inputs. */
export function serializeRunRecord(record: RunRecord): string {
  return canonicalJson(RunRecord.parse(record));
}

/** Parse and validate saved text. Throws on malformed or schema-invalid records. */
export function parseRunRecord(text: string): RunRecord {
  return RunRecord.parse(JSON.parse(text) as unknown);
}

export interface VerifiedRun extends ReplayOutcome {
  readonly record: RunRecord;
}

/** Re-run a saved record from its inputs only and compare it with the recorded hashes. */
export function verifyRunRecord(text: string): VerifiedRun {
  const record = parseRunRecord(text);
  return { record, ...replayRecord(record) };
}
