// Offline evaluation runner. Usage: tsx src/evaluate-cli.ts <seed-set> <out.json> [untilMs]
// seed-set: dev | showcase | heldout. Writes the report and prints a one-line summary per variant.
import { DEV_SEEDS, HELD_OUT_SEEDS, SHOWCASE_SEED, runEvaluation } from "./evaluation.js";

import { writeFileSync } from "node:fs";

const set = process.argv[2] ?? "dev";
const out = process.argv[3] ?? "evaluation.json";
const untilMs = process.argv[4] === undefined ? 1_500_000 : Number(process.argv[4]);
const seeds = set === "heldout" ? HELD_OUT_SEEDS : set === "showcase" ? [SHOWCASE_SEED] : DEV_SEEDS;
const started = Date.now();
const report = runEvaluation({ seeds, untilMs, onRun: (r) => process.stdout.write(`${r.variant} ${r.seed} end=${r.metrics.displayReason} sites=${r.metrics.sitesProtectedAndStanding}/${r.metrics.sites.length} lost=${r.metrics.crewsLost}\n`) });
writeFileSync(out, JSON.stringify(report, null, 2));
for (const v of report.variants) process.stdout.write(`SUMMARY ${v.variant} ${JSON.stringify(v.summary)}\n`);
process.stdout.write(`wall ${Math.round((Date.now() - started) / 1000)} s\n`);
