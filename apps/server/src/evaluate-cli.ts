// Offline evaluation runner. Usage: tsx src/evaluate-cli.ts <seed-set> <out.json> [untilMs]
// seed-set: dev | showcase | heldout. Writes the report and prints a one-line summary per variant.
import { DEV_SEEDS, HELD_OUT_SEEDS, SHOWCASE_SEED, runEvaluation } from "./evaluation.js";

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const set = process.argv[2] ?? "dev";
const outArg = process.argv[3] ?? "evaluation.json";
const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outRelative = outArg.replace(/^apps\/server\//, "");
const out = outArg.startsWith("/") ? outArg : join(serverRoot, outRelative);
const untilMs = process.argv[4] === undefined ? 1_500_000 : Number(process.argv[4]);
const seeds = set === "heldout" ? HELD_OUT_SEEDS : set === "showcase" ? [SHOWCASE_SEED] : DEV_SEEDS;
const started = Date.now();
const report = runEvaluation({ seeds, untilMs, onRun: (r) => process.stdout.write(`${r.variant} ${r.seed} end=${r.metrics.displayReason} sites=${r.metrics.sitesProtectedAndStanding}/${r.metrics.sites.length} lost=${r.metrics.crewsLost}\n`) });
function readGitHeadCommit(repoRoot: string): string | undefined {
  try {
    const headPath = join(repoRoot, ".git/HEAD");
    const head = readFileSync(headPath, "utf8").trim();
    if (head.startsWith("ref: ")) {
      return readFileSync(join(repoRoot, ".git", head.slice(5).trim()), "utf8").trim();
    }
    return head;
  } catch {
    return undefined;
  }
}
const repoRoot = join(serverRoot, "..", "..");
const measuredAtCommit = readGitHeadCommit(repoRoot);
const envelope = {
  ...report,
  ...(measuredAtCommit === undefined ? {} : { measuredAtCommit }),
  measuredAt: new Date().toISOString(),
};
writeFileSync(out, JSON.stringify(envelope, null, 2));
process.stdout.write(`wrote ${out}\n`);
if (set === "showcase") {
  process.stderr.write(
    "Note: showcase-1 is for rehearsal only; do not use these numbers for beat-6 variant comparison (see scripts/demo-comparison.mjs).\n",
  );
}
for (const v of report.variants) process.stdout.write(`SUMMARY ${v.variant} ${JSON.stringify(v.summary)}\n`);
process.stdout.write(`wall ${Math.round((Date.now() - started) / 1000)} s\n`);
