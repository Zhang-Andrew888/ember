/**
 * Pure statistics + labelling for the frame-rate script (scripts/perf.mjs).
 * Plain ESM so both node (the script) and vitest (tests) can import it.
 */

/** Frame budget for the 30 fps minimum target (docs/FRONTEND.md "Rendering and QA targets"). */
export const TARGET_FPS = 30;
export const TARGET_FRAME_MS = 1000 / TARGET_FPS;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const round = (n) => Math.round(n * 100) / 100;

/** @param {number[]} intervalsMs consecutive frame-to-frame intervals */
export function summarizeFrames(intervalsMs) {
  const frames = intervalsMs.length;
  if (frames === 0) {
    return { frames: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, fps: 0, over33msShare: 0, meetsTarget: false };
  }
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  const total = intervalsMs.reduce((sum, v) => sum + v, 0);
  const mean = total / frames;
  const over = intervalsMs.filter((v) => v > TARGET_FRAME_MS).length;
  const p95 = percentile(sorted, 95);
  return {
    frames,
    meanMs: round(mean),
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(p95),
    p99Ms: round(percentile(sorted, 99)),
    maxMs: round(sorted[sorted.length - 1]),
    fps: round(1000 / mean),
    over33msShare: round(over / frames),
    // The target is a sustained 30 fps: the mean must make it and the p95 frame must not blow the budget by much.
    meetsTarget: 1000 / mean >= TARGET_FPS && p95 <= TARGET_FRAME_MS * 1.5,
  };
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|softpipe|mesa offscreen|microsoft basic render/i;

/** True when the WebGL renderer string says the GPU is emulated on the CPU. */
export function isSoftwareRenderer(rendererString) {
  return SOFTWARE_RENDERER.test(rendererString ?? "");
}

export const SOFTWARE_LABEL = "cloud VM, headless Chromium, software rendering, not representative";

/**
 * The label every result carries. A software renderer can never be called
 * representative; a real GPU still needs a human-named machine.
 */
export function resultLabel({ renderer, machine, headless }) {
  if (isSoftwareRenderer(renderer)) return SOFTWARE_LABEL;
  if (!machine) return `UNNAMED MACHINE${headless ? " (headless)" : ""}: rerun with --machine "<name>" before quoting these numbers`;
  return `${machine}${headless ? " (headless Chromium)" : ""}`;
}

/** Parses "1440x900". */
export function parseViewport(text) {
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(text.trim());
  if (!match) throw new Error(`bad viewport "${text}", expected WIDTHxHEIGHT`);
  return { width: Number(match[1]), height: Number(match[2]) };
}
