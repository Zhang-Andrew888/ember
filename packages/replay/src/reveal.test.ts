import { describe, expect, it } from "vitest";
import { Incident, buildSyntheticScenario, recordOf } from "@ember/simulation";
import { revealFire } from "./index.js";

describe("replay truth reveal", () => {
  const incident = new Incident({ scenario: buildSyntheticScenario(), seed: "reveal" });
  incident.advanceTo(400_000);
  const record = recordOf(incident);

  it("reveals the full fire that live projections never contain", () => {
    const reveal = revealFire(record, 50_000);
    expect(reveal.finalSnapshotHash).toBe(record.finalSnapshotHash);
    const last = reveal.frames[reveal.frames.length - 1];
    const truthCells = new Set([...(last?.burning ?? []), ...(last?.burned ?? [])]);
    expect(truthCells.size).toBeGreaterThan(100);

    const view = incident.projectCoordinator();
    const known = new Set(view.observedCells.filter((c) => c.burnState !== "unburned").map((c) => c.cellIndex));
    const unseen = [...truthCells].filter((c) => !known.has(c));
    expect(unseen.length).toBeGreaterThan(50);

    const live = JSON.stringify([view, incident.projectAgent(view.agents[0]!.id)]);
    expect(live).not.toContain("ignitedAt");
    expect(live).not.toContain("cellState");
  });

  it("produces frames that grow over time and match the recorded run", () => {
    const reveal = revealFire(record, 50_000);
    expect(reveal.frames.length).toBeGreaterThan(5);
    const counts = reveal.frames.map((f) => f.burning.length + f.burned.length);
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0] ?? 0);
    expect(Number.isFinite(reveal.ignitedAtMs[record.scenario.map.initialFireCells[0]!])).toBe(true);
  });

  it("always ends on a frame at the recorded final time, whatever the frame interval", () => {
    const reveal = revealFire(record, 70_000);
    expect(reveal.frames[reveal.frames.length - 1]?.timeMs).toBe(record.finalTimeMs);
    const times = reveal.frames.map((f) => f.timeMs);
    expect(new Set(times).size).toBe(times.length);
  });
});
