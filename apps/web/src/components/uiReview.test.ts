import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { briefingContent } from "../briefing/briefingInfo.js";
import { scenarioMap } from "../map/activeScenario.js";
import { buildMoveDirectionDraft } from "../map/moveDirectionCommand.js";
import { formatElapsedWallTime } from "../format/time.js";
import { Briefing, briefingExample } from "./Briefing.js";
import { ConversationPanel, type ConversationPanelProps } from "./ConversationPanel.js";
import { EndOverlay } from "./EndOverlay.js";
import { MapCommandPanel, draftExplanation, type MapCommandPanelProps } from "./MapCommandPanel.js";
import { TopBar, STALE_SNAPSHOT_MS, audioStatusLabel } from "./TopBar.js";
import { UrgentStrip } from "./UrgentStrip.js";
import { urgentMarkers } from "./ReplayView.js";

const idleSpeech = { state: "idle", text: null, urgent: false, queuedUrgent: false, queuedRoutineCount: 0 } as const;

describe("U01 voice capability", () => {
  const conversation: ConversationPanelProps = {
    transcript: [],
    activeRecipientCallsign: null,
    onSendMessage: () => {},
    onPttBegin: () => {},
    onPttRelease: () => {},
    onPttCancel: () => {},
    composerDisabled: false,
    demoMode: false,
    speechSnapshot: idleSpeech,
  };

  it("labels sample voice as a sample line, never as speech recognition", () => {
    const html = renderToStaticMarkup(createElement(ConversationPanel, conversation));
    expect(html).toContain("Hold for sample voice line");
    expect(html).not.toContain("Push to talk");
  });

  it("offers real push to talk only when server speech recognition is wired", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationPanel, { ...conversation, grokStt: () => Promise.resolve(null) }),
    );
    expect(html).not.toContain("Hold for sample voice line");
  });

  it("briefing hides the microphone check in sample mode and says the microphone is unused", () => {
    const html = renderToStaticMarkup(
      createElement(Briefing, {
        onStart: () => {},
        starting: false,
        content: briefingContent(scenarioMap, true),
        demoMode: false,
        transportMode: "mock",
        voiceMode: "sample",
      }),
    );
    expect(html).toContain("recorded sample line");
    expect(html).not.toContain("Check microphone");
  });

  it("briefing says the microphone check does not test recognition in server mode", () => {
    const html = renderToStaticMarkup(
      createElement(Briefing, {
        onStart: () => {},
        starting: false,
        content: briefingContent(scenarioMap, true),
        demoMode: false,
        transportMode: "live",
        voiceMode: "server",
      }),
    );
    expect(html).toContain("Check microphone");
    expect(html).toContain("does not test recognition");
  });

  it("briefing gives a worked first command and a simulation label", () => {
    const content = { sites: [{ name: "Low", value: 1 }, { name: "High", value: 9 }], callsigns: ["Crew 2"], refugeNames: [], preview: null };
    expect(briefingExample(content)).toBe("\u201cCrew 2, protect High.\u201d");
    const html = renderToStaticMarkup(
      createElement(Briefing, { onStart: () => {}, starting: false, content, demoMode: false, transportMode: "live" }),
    );
    expect(html).toContain("Crew 2, protect High.");
    expect(html).toContain("fictional training simulation");
    expect(html).toContain("Relative value compares sites");
  });

  it("conversation separates the recipient from the inspected crew", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationPanel, { ...conversation, activeRecipientCallsign: "Crew 1", inspectedCallsign: "Crew 2" }),
    );
    expect(html).toContain("Conversation recipient: Crew 1");
    expect(html).toContain("Inspecting Crew 2 on the map does not address it.");
  });
});

describe("U02/U08/U14 map movement drafts", () => {
  const draft = buildMoveDirectionDraft({ agentId: "crew-1", callsign: "Crew 1", from: { x: 400, y: 400 }, to: { x: 400, y: 600 } })!;
  const props: MapCommandPanelProps = {
    assignMode: false,
    onToggleAssignMode: () => {},
    selectedCallsign: "Crew 2",
    selectedAgentId: "crew-2",
    draft,
    pickHint: null,
    delivery: null,
    disabled: false,
    onDraftDirection: () => {},
    onSend: () => {},
    onCancelDraft: () => {},
    open: true,
    onOpen: () => {},
    onClose: () => {},
  };

  it("keeps the draft addressed to its own crew and warns when another crew is inspected", () => {
    const html = renderToStaticMarkup(createElement(MapCommandPanel, props));
    expect(html).toContain("Send to Crew 1");
    expect(html).toContain("This draft is still addressed to Crew 1, not Crew 2.");
    expect(html).not.toContain("Send to Crew 2");
  });

  it("explains that a pick is a direction cue, not a destination", () => {
    const html = renderToStaticMarkup(createElement(MapCommandPanel, props));
    expect(html).toContain("Direction cue, not a route.");
    expect(draftExplanation(draft)).toContain("will not go to the exact point you picked (about 200 m away)");
    expect(draftExplanation(draft)).toContain("up to about 600 m (the default limit)");
  });

  it("shows reported crew details and a prepare-message action", () => {
    const html = renderToStaticMarkup(
      createElement(MapCommandPanel, {
        ...props,
        draft: null,
        crew: { agentId: "crew-2", callsign: "Crew 2", stateLabel: "Working", reported: "1:00 incident time", objective: "Doing structure protection", limitingReason: null },
        onPrepareMessage: () => {},
      }),
    );
    expect(html).toContain("Inspecting Crew 2");
    expect(html).toContain("Doing structure protection");
    expect(html).toContain("Prepare message to Crew 2");
  });

  it("shows delivery by recipient and the server's phase", () => {
    const html = renderToStaticMarkup(
      createElement(MapCommandPanel, {
        ...props,
        draft: null,
        delivery: {
          commandId: "c",
          commandText: draft.commandText,
          source: "map",
          agentId: "crew-1",
          callsign: "Crew 1",
          submitted: true,
          noticeIndexAtSend: 0,
          receiptIndexAtSend: 0,
          phase: "sent",
          explanation: null,
        },
      }),
    );
    expect(html).toContain("Last order to Crew 1");
    expect(html).toContain("Sent, waiting for Control");
  });
});

describe("U13/U15 header and urgent feedback", () => {
  it("says when audio is simulated", () => {
    expect(audioStatusLabel({ ...idleSpeech, state: "playing" }, true)).toMatch(/simulated/i);
    expect(audioStatusLabel({ ...idleSpeech, state: "playing" }, false)).not.toMatch(/simulated/i);
  });

  it("shows how old the map is once snapshots stop arriving", () => {
    const base = {
      transportMode: "live" as const,
      simTimeMs: 60_000,
      wallElapsedMs: 12_000,
      connectionStatus: "open" as const,
      speechSnapshot: idleSpeech,
    };
    expect(renderToStaticMarkup(createElement(TopBar, { ...base, snapshotAgeMs: 1_000 }))).not.toContain("s old");
    expect(renderToStaticMarkup(createElement(TopBar, { ...base, snapshotAgeMs: STALE_SNAPSHOT_MS + 3_000 }))).toContain(
      "map 8 s old",
    );
  });

  it("alerts only the urgent report, with audio status outside the alert", () => {
    const html = renderToStaticMarkup(
      createElement(UrgentStrip, {
        report: { sequence: 4 as never, simTimeMs: 1000 as never, agentId: "crew-1" as never, text: "Fire on the road.", urgent: true },
        callsign: "Crew 1",
        audioState: "playing",
        queuedUrgent: false,
        audioSimulated: true,
        onInspectCrew: () => {},
      }),
    );
    const alert = html.slice(html.indexOf('role="alert"'), html.indexOf("</div>", html.indexOf('role="alert"')));
    expect(alert).toContain("Fire on the road.");
    expect(alert).not.toMatch(/audio/i);
    expect(html).toContain("Inspect Crew 1");
  });

  it("rounds the elapsed real time instead of truncating 4:59.8 to 4:59", () => {
    expect(formatElapsedWallTime(299_800)).toBe("5:00");
  });
});

describe("U10 debrief and replay", () => {
  const view = CoordinatorView.parse(fixtureCoordinatorView);
  const incidentEnd = {
    tick: 300_000 as never,
    wallElapsedMs: 299_800 as never,
    matchingReasons: ["time_expired" as const],
    displayReason: "time_expired" as const,
    finalSnapshotHash: "h",
  };

  it("summarises observed outcomes without inventing a score", () => {
    const html = renderToStaticMarkup(
      createElement(EndOverlay, { incidentEnd, view, onStartAgain: () => {}, onReplay: () => {}, replayOffer: "illustrative" }),
    );
    expect(html).toContain("What you observed");
    for (const site of view.sites) expect(html).toContain(site.name);
    expect(html).not.toMatch(/score/i);
    expect(html).toContain("Replay (illustrative sample, not this run)");
  });

  it("lists one replay marker per new urgent report", () => {
    const urgent = { sequence: 9 as never, simTimeMs: 50_000 as never, agentId: "crew-1" as never, text: "Spot fire", urgent: true };
    const calm = { ...view, recentReports: [] };
    const alarmed = { ...view, recentReports: [urgent] };
    const markers = urgentMarkers([calm, alarmed, alarmed, calm]);
    expect(markers).toEqual([{ index: 1, simTimeMs: 50_000, agentId: "crew-1", text: "Spot fire" }]);
  });
});
