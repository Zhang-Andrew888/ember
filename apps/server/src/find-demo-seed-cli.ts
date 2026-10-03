// Offline search for a rehearsable demo seed.
// Usage: tsx src/find-demo-seed-cli.ts [count] [untilSimMs] [prefix] [overridesJson] [scriptJson]
// scriptJson is a list of [simMs, "coordinator text"] sent through the real conversation gateway, i.e. the
// documented coordinator objectives (docs/NAVIGATION_AGENTS.md); the beats themselves still come from the simulation.
// Runs the uncommanded live configuration (default scenario, controlled crews and scout) and reports,
// per seed, the sim time of the first scout fire report, withdrawal and yield. Lock a seed that has all
// three early with DEMO_SEED=<seed>.
import { buildSyntheticScenario, type PrivateOverrides } from "@ember/simulation";
import { ConversationBridge } from "./conversation.js";
import { IncidentSession } from "./session.js";

const count = process.argv[2] === undefined ? 40 : Number(process.argv[2]);
const untilMs = process.argv[3] === undefined ? 450_000 : Number(process.argv[3]);
const prefix = process.argv[4] ?? "demo";
const script = (process.argv[6] === undefined ? [] : JSON.parse(process.argv[6])) as [number, string][];
const overrides = (process.argv[5] === undefined ? {} : JSON.parse(process.argv[5])) as PrivateOverrides;

interface Row {
  readonly seed: string;
  readonly scout: number | null;
  readonly withdrawal: number | null;
  readonly yielded: number | null;
}

const fmt = (ms: number | null): string => (ms === null ? "-" : `${Math.round(ms / 1000)}s`);
const rows: Row[] = [];
for (let i = 1; i <= count; i++) {
  const seed = `${prefix}-${String(i).padStart(3, "0")}`;
  const session = new IncidentSession({ scenario: buildSyntheticScenario(), seed, overrides });
  const bridge = new ConversationBridge(session);
  const pending = [...script].sort((a, b) => a[0] - b[0]);
  session.runUntil(untilMs, () => {
    bridge.collect();
    while (pending.length > 0 && pending[0]![0] <= session.incident.simTimeMs) bridge.say(pending.shift()![1], session.incident.simTimeMs);
  });
  const scoutObs = session.incident.coordinator
    .observations()
    .filter((o) => o.sourceAgentId === "scout" && o.observedFields.some((f) => f.kind === "cell" && f.burnState !== "unburned"))
    .map((o) => o.observedAt as number);
  const first = (pred: (e: { type: string; reasonCode: string }) => boolean): number | null => {
    const hit = session.decisions.find((d) => pred(d.event));
    return hit === undefined ? null : (hit.event.tick as number);
  };
  const row: Row = {
    seed,
    scout: scoutObs.length === 0 ? null : Math.min(...scoutObs),
    withdrawal: first((e) => e.type === "withdrawal_triggered"),
    yielded: first((e) => e.reasonCode === "yielded_to_higher_priority"),
  };
  rows.push(row);
  process.stdout.write(`${seed} scout=${fmt(row.scout)} withdrawal=${fmt(row.withdrawal)} yield=${fmt(row.yielded)}\n`);
}
const complete = rows.filter((r) => r.scout !== null && r.withdrawal !== null && r.yielded !== null);
complete.sort((a, b) => Math.max(a.scout!, a.withdrawal!, a.yielded!) - Math.max(b.scout!, b.withdrawal!, b.yielded!));
process.stdout.write(`\n${complete.length}/${rows.length} seeds have all three within ${fmt(untilMs)} sim time. Best first:\n`);
for (const r of complete.slice(0, 5)) process.stdout.write(`  ${r.seed} scout=${fmt(r.scout)} withdrawal=${fmt(r.withdrawal)} yield=${fmt(r.yielded)}\n`);
