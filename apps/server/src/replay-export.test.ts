import { afterAll, describe, expect, it } from "vitest";
import { revealFire } from "@ember/replay";
import { buildSyntheticScenario, recordOf } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { ConversationBridge } from "./conversation.js";
import { LiveRun, SessionHub } from "./hub.js";
import { IncidentRegistry } from "./incident-registry.js";
import { replayRevealPasses, stopReplayWorker } from "./replay-offloop.js";
import { buildReplayExport } from "./replay-export.js";
import { IncidentSession } from "./session.js";
import { ViewRecorder } from "./view-recorder.js";

const patch = (x: number, y: number): number[] => [
  cellIndexOf(x, y)!,
  cellIndexOf(x + 25, y)!,
  cellIndexOf(x, y + 25)!,
  cellIndexOf(x + 25, y + 25)!,
];

afterAll(async () => {
  await stopReplayWorker();
});

describe("buildReplayExport", () => {
  it("returns null while the incident is active", async () => {
    const session = new IncidentSession({ scenario: buildSyntheticScenario(), seed: "replay-export" });
    const passes = replayRevealPasses();
    await expect(buildReplayExport(session, new ViewRecorder())).resolves.toBeNull();
    expect(replayRevealPasses()).toBe(passes);
  });

  it("returns coordinator log and truth frames after a ended run", async () => {
    const base = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] });
    const session = new IncidentSession({
      scenario: { ...base, map: { ...base.map, initialFireCells: patch(1500, 100) } },
      seed: "replay-export-end",
    });
    const recorder = new ViewRecorder();
    const bridge = new ConversationBridge(session);
    const hub = new SessionHub(session, bridge, recorder);
    const clock = { t: 5000, nowMs(): number { return this.t; } };
    const live = new LiveRun(session, bridge, hub, clock);
    hub.connect();
    live.start();
    clock.t += 400_000;
    live.pump();
    hub.afterStep();
    expect(session.incident.ended).toBe(true);

    const payload = await buildReplayExport(session, recorder);
    expect(payload).not.toBeNull();
    expect(payload!.coordinatorLog.length).toBeGreaterThanOrEqual(1);
    expect(payload!.truthFrames.length).toBeGreaterThanOrEqual(1);
    expect(payload!.end.tick).toBeGreaterThan(0);
    expect(recorder.coordinatorLog().length).toBeGreaterThanOrEqual(1);

    const direct = revealFire(recordOf(session.incident), 10_000);
    expect(payload!.truthFrames).toEqual(
      direct.frames.map((frame) => ({
        timeMs: frame.timeMs,
        burning: [...frame.burning],
        burned: [...frame.burned],
      })),
    );
  });

  it("reveals once and does not stall a live pump", async () => {
    const base = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] });
    const registry = new IncidentRegistry();
    const endedClock = { t: 5000, nowMs(): number { return this.t; } };
    const ended = registry.create(
      {
        scenario: { ...base, map: { ...base.map, initialFireCells: patch(1500, 100) } },
        seed: "replay-export-cache",
      },
      endedClock,
    );
    ended.live.start();
    endedClock.t += 400_000;
    ended.live.pump();
    expect(ended.session.incident.ended).toBe(true);

    const liveClock = { t: 1_000, nowMs(): number { return this.t; } };
    const live = registry.create({ seed: "replay-export-live" }, liveClock);
    live.live.start();
    const simBefore = live.session.incident.simTimeMs;
    const passesBefore = replayRevealPasses();

    const timer = setInterval(() => {
      liveClock.t += 200;
      live.live.safePump();
    }, 10);
    try {
      registry.prepareReplay(ended);
      registry.prepareReplay(ended);
      const first = registry.replayPayload(ended);
      const second = registry.replayPayload(ended);
      expect(second).toBe(first);
      const payload = await first;
      expect(replayRevealPasses()).toBe(passesBefore + 1);
      expect(live.session.incident.simTimeMs).toBeGreaterThan(simBefore);
      expect(payload).not.toBeNull();
      expect(payload!.truthFrames.length).toBeGreaterThanOrEqual(1);

      const third = await registry.replayPayload(ended);
      expect(replayRevealPasses()).toBe(passesBefore + 1);
      expect(third).toEqual(payload);
    } finally {
      clearInterval(timer);
    }
  });
});
