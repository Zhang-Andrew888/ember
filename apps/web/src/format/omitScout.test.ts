import { describe, expect, it } from "vitest";
import type { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { createMockIncidentSocket, authoredSnapshots } from "../net/mockIncidentSocket.js";
import { defaultRecordedMockSnapshots } from "../net/recordedMockPlayback.js";
import { replayLog } from "../net/replayLog.js";
import { SCENARIO_NAMES, resolveScenario } from "../net/scenarioSelection.js";
import { mockWireRepliesForSay } from "../net/mockCommandSimulator.js";
import { createMockVoiceAdapter } from "../net/mockVoiceAdapter.js";
import { parseCoordinatorViewFrame } from "../net/wireProtocol.js";
import { omitScoutCallsigns, omitScoutFromView } from "./omitScout.js";

const hasScout = (view: CoordinatorView) =>
  view.agents.some((agent) => agent.role === "scout") ||
  view.recentReports.some((report) => (report.agentId as string) === "scout") ||
  view.agentPlans.some((plan) => (plan.agentId as string) === "scout");

describe("format/omitScout (#118)", () => {
  it("the shared fixture still has a scout (it stays unchanged), so the filter has something to remove", () => {
    expect(hasScout(fixtureCoordinatorView)).toBe(true);
  });

  it("removes scout agents, plans and reports and keeps every crew", () => {
    const filtered = omitScoutFromView(fixtureCoordinatorView);
    expect(hasScout(filtered)).toBe(false);
    expect(filtered.agents.map((agent) => agent.id)).toEqual(["crew-1", "crew-2"]);
    expect(filtered.observedCells).toEqual(fixtureCoordinatorView.observedCells);
    expect(filtered.sites).toEqual(fixtureCoordinatorView.sites);
  });

  it("clears an active recipient that was a scout and keeps a crew recipient", () => {
    expect(omitScoutFromView({ ...fixtureCoordinatorView, activeRecipientId: "scout" as never }).activeRecipientId).toBeNull();
    expect(omitScoutFromView({ ...fixtureCoordinatorView, activeRecipientId: "crew-1" as never }).activeRecipientId).toBe("crew-1");
  });

  it("returns the same object when there is no scout", () => {
    const crewOnly = omitScoutFromView(fixtureCoordinatorView);
    expect(omitScoutFromView(crewOnly)).toBe(crewOnly);
  });

  it("filters callsigns", () => {
    expect(omitScoutCallsigns(["Crew 1", "Scout", "Crew 2"])).toEqual(["Crew 1", "Crew 2"]);
  });
});

describe("new demo sessions carry no scout (#118)", () => {
  async function emitted(snapshots?: CoordinatorView[]): Promise<CoordinatorView[]> {
    const { vi } = await import("vitest");
    vi.useFakeTimers();
    try {
      const socket = createMockIncidentSocket({ ...(snapshots ? { snapshots } : {}), intervalMs: 10 });
      const views: CoordinatorView[] = [];
      socket.onmessage = (event) => {
        const view = parseCoordinatorViewFrame(event.data as string);
        if (view) views.push(view);
      };
      await vi.advanceTimersByTimeAsync(1);
      socket.start();
      await vi.advanceTimersByTimeAsync(5000);
      socket.close();
      return views;
    } finally {
      vi.useRealTimers();
    }
  }

  it("the recorded default playback has a scout in the source JSON but none on the wire", async () => {
    expect(defaultRecordedMockSnapshots().every(hasScout)).toBe(true);
    const views = await emitted();
    expect(views.length).toBe(defaultRecordedMockSnapshots().length);
    expect(views.some(hasScout)).toBe(false);
    expect(views.every((view) => view.agents.length > 0 && view.agents.every((agent) => agent.role === "protection_crew"))).toBe(true);
  });

  it("the authored snapshots and every dev preset are scout-free when emitted", async () => {
    expect((await emitted(authoredSnapshots)).some(hasScout)).toBe(false);
    for (const name of SCENARIO_NAMES) {
      const snapshots = resolveScenario(`?scenario=${name}`)?.snapshots;
      if (!snapshots) continue;
      expect((await emitted(snapshots)).some(hasScout), name).toBe(false);
    }
  });

  it("the illustrative replay log has no scout", () => {
    expect(replayLog.some(hasScout)).toBe(false);
  });

  it("mock replies and voice-demo prompts never suggest a scout command", () => {
    let clock = 0;
    const adapter = createMockVoiceAdapter({ now: () => clock, minHoldMs: 1 });
    for (let i = 0; i < 6; i++) {
      adapter.start();
      clock += 10;
      expect(adapter.commit()?.text.toLowerCase()).not.toContain("scout");
    }
    expect(mockWireRepliesForSay("status", 0, "c").join(" ").toLowerCase()).not.toContain("scout");
  });
});

describe("demo copy guard (#118)", () => {
  const sources = import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "../**/*.css", "!../**/*.test.ts", "!../**/*.test.tsx"], {
    eager: true,
    query: "?raw",
    import: "default",
  });

  it("only data sources, the role schema mapping and the filter itself mention a scout", () => {
    const mentioning = Object.entries(sources)
      .filter(([, source]) => /scout/i.test(source))
      .map(([path]) => (path.startsWith("./") ? `format/${path.slice(2)}` : path.slice(3)))
      .sort();
    expect(mentioning).toEqual(
      [
        "briefing/briefingInfo.ts", // imports the filter
        "components/AgentRail.tsx", // neutral label for a non-crew role in an old recording
        "format/omitScout.ts",
        "map/scenarioSchema.ts", // public map data (scoutPoints), not UI
        "net/mockIncidentSocket.ts", // authored fixture-based data, filtered on emit
        "net/replayLog.ts", // imports the filter
        "net/scenarios.ts", // fixture-based presets, filtered on emit
      ].sort(),
    );
  });
});
