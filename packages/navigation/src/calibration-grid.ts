import type { NavConfig } from "./types.js";
import { DEFAULT_NAV_CONFIG } from "./types.js";

/** One knob bundle for offline exploration. Values are versioned constants, not learned weights. */
export interface NavCalibrationPreset {
  readonly id: string;
  /** Short human name for reports and the CLI output. */
  readonly name: string;
  /** What the preset changes relative to the defaults, in one sentence. */
  readonly description: string;
  readonly nav?: Partial<NavConfig>;
  /** Documented controller knobs that affect mission choice (passed through evaluation harness). */
  readonly switchMargin?: number;
  readonly switchCooldownMs?: number;
}

/** Small grid for dev-seed sweeps. Not tuned against held-out seeds in CI. */
export const NAV_CALIBRATION_PRESETS: readonly NavCalibrationPreset[] = [
  { id: "default", name: "Default", description: "Baseline: every knob at its library default.", nav: {} },
  { id: "buffer-tight", name: "Tight safety buffer", description: "Safety buffer reduced to 25 s.", nav: { bufferMs: 25_000 } },
  { id: "buffer-loose", name: "Loose safety buffer", description: "Safety buffer raised to 35 s.", nav: { bufferMs: 35_000 } },
  {
    id: "work-finer",
    name: "Finer work intervals",
    description: "Minimum work interval and work step both 15 s, so shorter jobs are considered.",
    nav: { minWorkMs: 15_000, workStepMs: 15_000 },
  },
  {
    id: "switch-eager",
    name: "Eager mission switching",
    description: "Switch to a better mission at a 1.15 margin after a 25 s cooldown.",
    switchMargin: 1.15,
    switchCooldownMs: 25_000,
  },
  {
    id: "switch-cautious",
    name: "Cautious mission switching",
    description: "Switch only at a 1.25 margin after a 35 s cooldown.",
    switchMargin: 1.25,
    switchCooldownMs: 35_000,
  },
];

export function mergeNavConfig(base: NavConfig, patch: Partial<NavConfig>): NavConfig {
  return { ...base, ...patch };
}

export function presetNavConfig(preset: NavCalibrationPreset, base: NavConfig = DEFAULT_NAV_CONFIG): NavConfig {
  return mergeNavConfig(base, preset.nav ?? {});
}
