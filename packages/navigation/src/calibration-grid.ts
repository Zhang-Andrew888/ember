import type { NavConfig } from "./types.js";
import { DEFAULT_NAV_CONFIG } from "./types.js";

/** One knob bundle for offline exploration. Values are versioned constants, not learned weights. */
export interface NavCalibrationPreset {
  readonly id: string;
  readonly nav?: Partial<NavConfig>;
  /** Documented controller knobs that affect mission choice (passed through evaluation harness). */
  readonly switchMargin?: number;
  readonly switchCooldownMs?: number;
}

/** Small grid for dev-seed sweeps. Not tuned against held-out seeds in CI. */
export const NAV_CALIBRATION_PRESETS: readonly NavCalibrationPreset[] = [
  { id: "default", nav: {} },
  { id: "buffer-tight", nav: { bufferMs: 25_000 } },
  { id: "buffer-loose", nav: { bufferMs: 35_000 } },
  { id: "work-finer", nav: { minWorkMs: 15_000, workStepMs: 15_000 } },
  { id: "switch-eager", switchMargin: 1.15, switchCooldownMs: 25_000 },
  { id: "switch-cautious", switchMargin: 1.25, switchCooldownMs: 35_000 },
];

export function mergeNavConfig(base: NavConfig, patch: Partial<NavConfig>): NavConfig {
  return { ...base, ...patch };
}

export function presetNavConfig(preset: NavCalibrationPreset, base: NavConfig = DEFAULT_NAV_CONFIG): NavConfig {
  return mergeNavConfig(base, preset.nav ?? {});
}
