#!/usr/bin/env node
/**
 * Frame-rate measurement for the Three.js scene (brief item 7).
 *
 *   pnpm --filter ember-web perf -- --machine "MacBook Pro M2 (Andrew)"
 *
 * What it does: starts the Vite DEV server (never a production build), opens
 * Chromium at the target viewport, starts the incident, forces continuous
 * rendering (?perfContinuous, dev-only), and for each quality tier records the
 * frame-to-frame interval from requestAnimationFrame for a few seconds. With
 * rendering continuous, that interval is the frame time the scene can sustain.
 * The output labels itself: a software WebGL renderer is always reported as
 * "cloud VM, headless Chromium, software rendering, not representative", and a
 * real GPU run without --machine is flagged UNNAMED.
 *
 * Options (all optional):
 *   --viewport 1440x900[,1024x720]   default 1440x900 (the target viewport)
 *   --tiers low,medium,high          default all
 *   --seconds 6                      measured seconds per tier (after 2 s warm-up)
 *   --machine "<name>"               REQUIRED label for any real-GPU result
 *   --url http://localhost:5173      use a running dev server instead of starting one
 *   --headed                         show the browser (default headless)
 *   --out <dir>                      default apps/web/perf-results
 * Environment: CHROMIUM_PATH selects a browser binary; otherwise a Chromium under
 * PLAYWRIGHT_BROWSERS_PATH is used, else Playwright's own.
 *
 * Playwright is not a dependency of this repo; the script resolves it from the
 * local node_modules or, failing that, the global npm root.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isSoftwareRenderer, parseViewport, resultLabel, summarizeFrames, TARGET_FPS } from "./frameStats.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function loadPlaywright() {
  for (const base of [join(webRoot, "package.json"), join(webRoot, "..", "..", "package.json")]) {
    try {
      return createRequire(base)("playwright");
    } catch {
      /* try next */
    }
  }
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return createRequire(join(globalRoot, "x.js"))("playwright");
  } catch {
    throw new Error("Playwright not found. Install it (npm i -g playwright) or add it locally, then rerun.");
  }
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      for (const sub of ["chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win/chrome.exe"]) {
        const candidate = join(root, dir, sub);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`dev server at ${url} did not start`);
}

async function startDevServer(port) {
  const child = spawn("pnpm", ["exec", "vite", "--port", String(port), "--strictPort"], {
    cwd: webRoot,
    stdio: "ignore",
    detached: false,
  });
  await waitForServer(`http://localhost:${port}/`);
  return child;
}

async function measureTier(browser, { url, viewport, tier, seconds }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${url}/?perfContinuous`);
  await page.getByRole("button", { name: /start incident/i }).click();
  // Select the tier through the dev-only debug panel (same code path a developer uses).
  await page.locator(".debug-panel summary").click();
  await page.locator(".debug-panel select").selectOption(tier);
  await page.waitForTimeout(2000); // warm-up: shader compiles, first snapshots, tier change
  const result = await page.evaluate(async (ms) => {
    const intervals = [];
    let last = performance.now();
    const end = last + ms;
    await new Promise((done) => {
      const tick = (now) => {
        intervals.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(tick);
        else done(undefined);
      };
      requestAnimationFrame(tick);
    });
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return { intervals: intervals.slice(1), renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null };
  }, seconds * 1000);
  await context.close();
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const viewports = String(args.viewport ?? "1440x900").split(",").map(parseViewport);
  const tiers = String(args.tiers ?? "low,medium,high").split(",");
  const seconds = Number(args.seconds ?? 6);
  const machine = typeof args.machine === "string" ? args.machine : undefined;
  const headless = !args.headed;
  const outDir = resolve(typeof args.out === "string" ? args.out : join(webRoot, "perf-results"));

  const { chromium } = loadPlaywright();
  let server;
  let url = typeof args.url === "string" ? args.url.replace(/\/$/, "") : undefined;
  if (!url) {
    const port = 5190 + Math.floor(Math.random() * 50);
    server = await startDevServer(port);
    url = `http://localhost:${port}`;
  }

  const executablePath = findChromium();
  const browser = await chromium.launch({
    headless,
    ...(executablePath ? { executablePath } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"].filter(
      // On a machine with a real GPU, do not force software GL.
      () => !args["real-gpu"],
    ),
  });

  const rows = [];
  let renderer = null;
  try {
    for (const viewport of viewports) {
      for (const tier of tiers) {
        const { intervals, renderer: r } = await measureTier(browser, { url, viewport, tier, seconds });
        renderer = r ?? renderer;
        rows.push({ viewport: `${viewport.width}x${viewport.height}`, tier, ...summarizeFrames(intervals) });
      }
    }
  } finally {
    await browser.close();
    server?.kill();
  }

  const label = resultLabel({ renderer, machine, headless });
  const report = {
    label,
    renderer,
    softwareRendering: isSoftwareRenderer(renderer),
    targetFps: TARGET_FPS,
    secondsPerTier: seconds,
    date: new Date().toISOString(),
    node: process.version,
    results: rows,
  };
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `perf-${report.date.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");

  console.log(`\n${label}\nrenderer: ${renderer}\n`);
  console.log("viewport   tier    fps    mean   p50    p95    p99    max    >33ms  target(30fps)");
  for (const row of rows) {
    console.log(
      `${row.viewport.padEnd(10)} ${row.tier.padEnd(7)} ${String(row.fps).padEnd(6)} ${String(row.meanMs).padEnd(6)} ${String(row.p50Ms).padEnd(6)} ${String(row.p95Ms).padEnd(6)} ${String(row.p99Ms).padEnd(6)} ${String(row.maxMs).padEnd(6)} ${String(row.over33msShare).padEnd(6)} ${row.meetsTarget ? "MET" : "MISSED"}`,
    );
  }
  console.log(`\nwritten: ${file}`);
  if (!machine && !report.softwareRendering) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
