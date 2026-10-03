import { describe, expect, it } from "vitest";
import { buildSyntheticScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { ConversationBridge } from "./conversation.js";
import { LiveRun, SessionHub } from "./hub.js";
import { buildReplayExport } from "./replay-export.js";
import { IncidentSession } from "./session.js";
import { ViewRecorder } from "./view-recorder.js";

const patch = (x: number, y: number): number[] => [
  cellIndexOf(x, y)!,
  cellIndexOf(x + 25, y)!,
  cellIndexOf(x, y + 25)!,
  cellIndexOf(x + 25, y + 25)!,
];

describe("buildReplayExport", () => {
  it("returns null while the incident is active", () => {
    const session = new IncidentSession({ scenario: buildSyntheticScenario(), seed: "replay-export" });
    expect(buildReplayExport(session, new ViewRecorder())).toBeNull();
  });

  it("returns coordinator log and truth frames after a ended run", () => {
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

    const payload = buildReplayExport(session, recorder);
    expect(payload).not.toBeNull();
    expect(payload!.coordinatorLog.length).toBeGreaterThanOrEqual(1);
    expect(payload!.truthFrames.length).toBeGreaterThanOrEqual(1);
    expect(payload!.end.tick).toBeGreaterThan(0);
    expect(recorder.coordinatorLog().length).toBeGreaterThanOrEqual(1);
  });
});
