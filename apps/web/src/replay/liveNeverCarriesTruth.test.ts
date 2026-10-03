import { afterEach, describe, expect, it, vi } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { adaptToScenarioIds } from "../net/mockBase.js";
import {
  authoredSnapshots,
  createMockIncidentSocket,
  type MockIncidentSocketOptions,
} from "../net/mockIncidentSocket.js";
import { SCENARIO_NAMES, resolveScenario } from "../net/scenarioSelection.js";
import { modelStatesScenario, runEndedScenarios } from "../net/scenarios.js";
import { parseCoordinatorViewFrame } from "../net/wireProtocol.js";
import { buildSceneEntities } from "../components/scene/sceneEntities.js";
import { scenarioMap } from "../map/activeScenario.js";
import { mockRecording, mockTruthFrames } from "./mockRecording.js";
import { truthForDisplay, type AppPhase } from "./truthGate.js";

/**
 * Proof that the full fire exists ONLY in replay.
 * 1. every payload the live app can receive carries no truth (schema-strict and key-scanned);
 * 2. the wire client strips anything extra a server might send;
 * 3. the single display gate releases truth only in replay with the toggle on;
 * 4. no module except ReplayView can even import the truth data.
 */

/** Keys that would mean private/true world state leaked into a coordinator payload. */
const TRUTH_KEYS = [
  "truth",
  "truthFrames",
  "truthFrame",
  "trueFire",
  "fullFire",
  "burning",
  "burned",
  "cellState",
  "cellIgnitedAtMs",
  "ignitedAtMs",
  "unseen",
  "privateWorldParameters",
  "requiredWork",
  "finalSnapshot",
];

function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      allKeys(child, into);
    }
  }
  return into;
}

function livePayloads(): Array<{ source: string; view: CoordinatorView }> {
  const out: Array<{ source: string; view: CoordinatorView }> = [{ source: "fixture", view: fixtureCoordinatorView }];
  authoredSnapshots.forEach((view, i) => out.push({ source: `authoredSnapshots[${i}]`, view }));
  out.push({ source: "modelStatesScenario", view: modelStatesScenario });
  for (const [reason, view] of Object.entries(runEndedScenarios)) out.push({ source: `ended:${reason}`, view });
  for (const name of SCENARIO_NAMES) {
    const options = resolveScenario(`?scenario=${name}`);
    options?.snapshots?.forEach((view, i) => out.push({ source: `scenario:${name}[${i}]`, view }));
  }
  return out.map(({ source, view }) => ({ source, view: adaptToScenarioIds(view) }));
}

describe("live payloads carry no truth", () => {
  const payloads = livePayloads();

  it("covers a meaningful set of payloads", () => {
    expect(payloads.length).toBeGreaterThan(15);
  });

  it.each(payloads.map((p) => [p.source, p.view] as const))("%s validates strictly and has no truth keys", (_source, view) => {
    // Strict parse at the top level: any field outside the CoordinatorView contract fails.
    expect(CoordinatorView.strict().safeParse(view).success).toBe(true);
    const keys = allKeys(view);
    for (const forbidden of TRUTH_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
  });

  it("no live payload has a fire cell the scene would draw as unseen (that flag is replay-only)", () => {
    for (const { view } of payloads) {
      const entities = buildSceneEntities(view, scenarioMap);
      expect(entities.fireCells.some((cell) => cell.unseen !== undefined)).toBe(false);
    }
  });

  it("live observed fire is a tiny subset of the truth (the truth is not leaking through observedCells)", () => {
    const truthCells = new Set(mockTruthFrames.flatMap((f) => [...f.burning, ...f.burned]));
    const liveCells = new Set(payloads.flatMap(({ view }) => view.observedCells.map((c) => c.gridCellIndex)));
    expect(truthCells.size).toBeGreaterThan(liveCells.size * 5);
  });
});

describe("what the mock socket actually emits", () => {
  afterEach(() => vi.useRealTimers());

  async function emitted(options: MockIncidentSocketOptions = {}): Promise<string[]> {
    vi.useFakeTimers();
    const socket = createMockIncidentSocket({
      ...options,
      intervalMs: options.intervalMs ?? 10,
    });
    const frames: string[] = [];
    socket.onmessage = (event) => frames.push(event.data as string);
    await vi.advanceTimersByTimeAsync(1);
    socket.start();
    await vi.advanceTimersByTimeAsync(1000);
    socket.close();
    return frames;
  }

  it("default demo frames parse through the production wire parser with no truth keys", async () => {
    const frames = await emitted({ snapshots: authoredSnapshots });
    expect(frames.length).toBe(authoredSnapshots.length);
    for (const raw of frames) {
      const view = parseCoordinatorViewFrame(raw);
      expect(view).not.toBeNull();
      const keys = allKeys(JSON.parse(raw));
      for (const forbidden of TRUTH_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });

  it("every dev preset's frames are truth-free too", async () => {
    for (const name of SCENARIO_NAMES) {
      const options = resolveScenario(`?scenario=${name}`);
      if (!options?.snapshots || options.failToOpen) continue;
      for (const raw of await emitted(options)) {
        const keys = allKeys(JSON.parse(raw));
        for (const forbidden of TRUTH_KEYS) expect(keys.has(forbidden), `${name}: ${forbidden}`).toBe(false);
      }
    }
  });
});

describe("the wire client strips anything a server adds", () => {
  it("a frame carrying truth alongside a valid view yields a view without it", () => {
    const poisoned = {
      ...adaptToScenarioIds(fixtureCoordinatorView),
      truthFrames: mockTruthFrames,
      privateWorldParameters: { wind: 3 },
    };
    const view = parseCoordinatorViewFrame(JSON.stringify(poisoned));
    expect(view).not.toBeNull();
    const keys = allKeys(view);
    expect(keys.has("truthFrames")).toBe(false);
    expect(keys.has("privateWorldParameters")).toBe(false);
  });
});

describe("the display gate", () => {
  const frame = mockTruthFrames[3]!;
  const phases: AppPhase[] = ["briefing", "live", "replay"];

  it("releases truth only in replay with the toggle on", () => {
    for (const phase of phases) {
      for (const showFullFire of [false, true]) {
        const shown = truthForDisplay({ phase, showFullFire, frame });
        expect(shown !== null, `${phase}/${showFullFire}`).toBe(phase === "replay" && showFullFire);
      }
    }
  });

  it("returns null when there is no frame, even in replay with the toggle on", () => {
    expect(truthForDisplay({ phase: "replay", showFullFire: true, frame: null })).toBeNull();
  });
});

describe("only ReplayView may reach the truth data", () => {
  const all = import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
    eager: true,
    query: "?raw",
    import: "default",
  });
  const files = Object.entries(all).map(([path, source]) => ({ path: path.replace("../", ""), source }));
  const importers = (pattern: RegExp) =>
    files.filter(({ path, source }) => !path.startsWith("replay/") && pattern.test(source)).map(({ path }) => path);

  it("nothing outside replay/ imports the recording, the mock truth or the gate except ReplayView", () => {
    expect(importers(/replay\/(recording|mockRecording|truthGate)\.js/).sort()).toEqual(
      ["components/ReplayView.tsx", "net/incidentRestClient.ts"].sort(),
    );
  });

  it("App's live path never imports from replay/", () => {
    const app = files.find(({ path }) => path === "App.tsx")!.source;
    expect(app).not.toMatch(/from "\.\/replay\//);
  });

  it("the recording is a separate channel from the coordinator log it accompanies", () => {
    expect(Object.keys(mockRecording).sort()).toEqual(["coordinatorLog", "truthFrames"]);
    for (const view of mockRecording.coordinatorLog) {
      expect(allKeys(view).has("truthFrames")).toBe(false);
    }
  });
});
