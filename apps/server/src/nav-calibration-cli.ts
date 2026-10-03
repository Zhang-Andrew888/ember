/**
 * Exploratory navigation calibration: sweeps documented NavConfig and switching knobs on
 * development seeds under the scripted coordinator. This is not reinforcement learning and
 * does not optimize held-out headline win rates — it maps how constants move outcomes, as
 * docs/SIMULATION.md and docs/NAVIGATION_AGENTS.md describe.
 *
 * Usage: pnpm --filter ember-server exec tsx src/nav-calibration-cli.ts [out.json]
 */
import { writeFileSync } from "node:fs";
import { DEFAULT_CONTROLLER_CONFIG } from "@ember/agents";
import { NAV_CALIBRATION_PRESETS, presetNavConfig } from "@ember/navigation";
import { summarize } from "@ember/replay";
import { DEV_SEEDS, overridesForSeed, runVariant } from "./evaluation.js";

const variant = "ember_line" as const;

const out: Record<string, unknown> = {
  kind: "ember-nav-calibration-exploratory-v1",
  variant,
  seeds: DEV_SEEDS,
  caveat:
    "Dev seeds only. Do not pick a preset by maximizing work delivered; use for sensitivity and documentation.",
  presets: {},
};

for (const preset of NAV_CALIBRATION_PRESETS) {
  const runs = DEV_SEEDS.map((seed, i) =>
    runVariant({
      variant,
      seed,
      overrides: overridesForSeed(seed, i),
      controllerConfig: {
        nav: presetNavConfig(preset),
        ...(preset.switchMargin === undefined ? {} : { switchMargin: preset.switchMargin }),
        ...(preset.switchCooldownMs === undefined ? {} : { switchCooldownMs: preset.switchCooldownMs }),
        rebuildLatencyMs: DEFAULT_CONTROLLER_CONFIG.rebuildLatencyMs,
        reassessEveryMs: DEFAULT_CONTROLLER_CONFIG.reassessEveryMs,
      },
    }).metrics,
  );
  const s = summarize(runs);
  (out.presets as Record<string, unknown>)[preset.id] = {
    name: preset.name,
    description: preset.description,
    nav: preset.nav,
    switchMargin: preset.switchMargin ?? DEFAULT_CONTROLLER_CONFIG.switchMargin,
    switchCooldownMs: preset.switchCooldownMs ?? DEFAULT_CONTROLLER_CONFIG.switchCooldownMs,
    summary: s,
  };
  process.stdout.write(
    `${preset.id} (${preset.name}) work=${s.meanWorkDelivered.toFixed(1)} standing=${s.meanSitesProtectedAndStanding.toFixed(2)} lost=${s.meanCrewsLost.toFixed(2)} missions=${s.totalMissionsStarted}\n`,
  );
}

writeFileSync(process.argv[2] ?? "nav-calibration.json", JSON.stringify(out, null, 2));
