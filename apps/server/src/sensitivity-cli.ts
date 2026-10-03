// Exploratory only: how much does the width of the briefed prior change what the forecast planner
// does? Usage: tsx src/sensitivity-cli.ts <out.json>. This is not a performance claim and no
// setting here is tuned against outcomes; it maps a calibration constant, as the docs ask.
import { writeFileSync } from "node:fs";
import { DEFAULT_FORECAST_CONFIG, type ForecastConfig } from "@ember/forecast";
import { summarize } from "@ember/replay";
import { DEV_SEEDS, overridesForSeed, runVariant } from "./evaluation.js";

const priors: Record<string, ForecastConfig["prior"]> = {
  default: DEFAULT_FORECAST_CONFIG.prior,
  // Spans the true world's sampling ranges exactly (a prior that honestly knows how uncertain it is).
  world_ranges: {
    spreadMultiplier: { min: 0.6, max: 1.6 },
    windOffsetDeg: { min: -15, max: 15 },
    shiftTimeMs: { min: 250_000, max: 650_000 },
    postShiftDeg: { min: 45, max: 100 },
  },
  // A narrower prior than the default around the world's middle.
  narrow: {
    spreadMultiplier: { min: 0.9, max: 1.1 },
    windOffsetDeg: { min: -10, max: 10 },
    shiftTimeMs: { min: 400_000, max: 500_000 },
    postShiftDeg: { min: 60, max: 85 },
  },
};

const out: Record<string, unknown> = {};
for (const [name, prior] of Object.entries(priors)) {
  const runs = DEV_SEEDS.map((seed, i) =>
    runVariant({ variant: "forecast_no_scout", seed, overrides: overridesForSeed(seed, i), controllerConfig: { forecast: { ...DEFAULT_FORECAST_CONFIG, prior } } }).metrics,
  );
  const s = summarize(runs);
  out[name] = s;
  process.stdout.write(`${name} work=${s.meanWorkDelivered} standing=${s.meanSitesProtectedAndStanding} lost=${s.meanCrewsLost} started=${s.totalMissionsStarted}\n`);
}
writeFileSync(process.argv[2] ?? "sensitivity.json", JSON.stringify(out, null, 2));
