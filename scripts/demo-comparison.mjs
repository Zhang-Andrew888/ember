#!/usr/bin/env node
/**
 * Present held-out evaluation aggregates for the demo closing (VALIDATION.md ~1:45–2:00).
 * Uses apps/server/evaluation-results/heldout-20-seeds.json only — never showcase-1.
 *
 * Usage: node scripts/demo-comparison.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = join(root, "apps/server/evaluation-results/heldout-20-seeds.json");

const VARIANT_LABEL = {
  dispatch: "Dispatch baseline",
  forecast_no_scout: "Forecast, no scout",
  ember_line: "Ember Line",
};

const SAFETY_SEEDS = ["heldout-15", "heldout-18", "heldout-19"];

function fmt(n, digits = 1) {
  if (typeof n !== "number" || Number.isNaN(n)) return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

const raw = readFileSync(reportPath, "utf8");
const report = JSON.parse(raw);

if (report.seeds?.length !== 20 || report.seeds.some((s) => !String(s).startsWith("heldout-"))) {
  console.error("Expected held-out 20-seed report at", reportPath);
  process.exit(1);
}

const measuredAt =
  report.measuredAtCommit !== undefined
    ? `measured at git ${report.measuredAtCommit}`
    : "measured at 7b2832d (re-run evaluate-cli heldout to refresh on current main)";

console.log("");
console.log("Ember Line — held-out comparison (20 seeds, scripted coordinator policy v2)");
console.log(`Source: ${reportPath.replace(root + "/", "")}`);
console.log(`Scenario hash ${report.scenarioHash?.slice(0, 8) ?? "?"}… · ${measuredAt}`);
console.log("");
console.log("| Metric (mean unless noted) | Dispatch | Forecast, no scout | Ember Line |");
console.log("|---|---:|---:|---:|");

const byVariant = Object.fromEntries(report.variants.map((v) => [v.variant, v]));
const row = (label, pick) => {
  const cells = ["dispatch", "forecast_no_scout", "ember_line"].map((k) => fmt(pick(byVariant[k])));
  console.log(`| ${label} | ${cells.join(" | ")} |`);
};

row("Protection work delivered", (v) => v?.summary?.meanWorkDelivered);
row("Sites protected and standing (of 3)", (v) => v?.summary?.meanSitesProtectedAndStanding);
row("Sites destroyed", (v) => v?.summary?.meanSitesDestroyed);
row("Crews lost (total over 20 runs)", (v) => {
  const s = v?.summary;
  if (s === undefined) return "?";
  return Math.round(s.meanCrewsLost * s.runs);
});

const perfMax = Math.max(...report.variants.map((v) => v.simStepMaxMs ?? 0));
const perfP95 = Math.max(...report.variants.map((v) => v.simStepP95Ms ?? 0));
console.log("");
console.log(
  `Performance (harness): authoritative step p95 ${perfP95} ms; max ${perfMax} ms across variants (see JSON simStep* fields).`,
);

console.log("");
console.log("Safety contrast (dispatch baseline vs forecast planners on selected held-out seeds):");
for (const seed of SAFETY_SEEDS) {
  const parts = [];
  for (const key of ["dispatch", "forecast_no_scout", "ember_line"]) {
    const run = byVariant[key]?.runs?.find((r) => r.seed === seed);
    if (run === undefined) continue;
    parts.push(`${VARIANT_LABEL[key]}: work ${run.protectionWorkDelivered}, sites standing ${run.sitesProtectedAndStanding}, crews lost ${run.crewsLost}, end ${run.displayReason}`);
  }
  console.log(`  ${seed}: ${parts.join(" · ")}`);
}

const failureLines = (report.failures ?? []).filter((f) => SAFETY_SEEDS.includes(f.seed) && f.variant === "dispatch");
if (failureLines.length > 0) {
  console.log("  Dispatch failure notes:", failureLines.map((f) => `${f.seed} (${f.kind}: ${f.detail})`).join("; "));
}

console.log("");
console.log("Caveats (read aloud or show on slide):");
for (const c of report.caveats ?? []) {
  console.log(`  · ${c}`);
}
console.log("");
console.log("Do not quote showcase-1 single-seed numbers for variant comparison (rehearsal seed only).");
console.log("");
