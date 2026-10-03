import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Briefing } from "./Briefing.js";
import { TopBar } from "./TopBar.js";
import { UrgentStrip } from "./UrgentStrip.js";
import { ConnectionBanner } from "./ConnectionBanner.js";
import { DemoBanner } from "./DemoBanner.js";

describe("components markup", () => {
  it("Briefing exposes start control and site list", () => {
    const html = renderToStaticMarkup(
      createElement(Briefing, { onStart: () => {}, starting: false, demoMode: false, transportMode: "live" }),
    );
    expect(html).toContain("Start incident");
    expect(html).toContain("Sites to protect");
  });

  it("TopBar shows connection and audio status", () => {
    const html = renderToStaticMarkup(
      createElement(TopBar, {
        transportMode: "live",
        simTimeMs: 60_000,
        wallElapsedMs: 12_000,
        connectionStatus: "open",
        speechSnapshot: {
          state: "idle",
          text: null,
          urgent: false,
          queuedUrgent: false,
          queuedRoutineCount: 0,
        },
      }),
    );
    expect(html).toContain("Connected");
    expect(html).toContain("Audio idle");
    expect(html).toContain("LIVE");
  });

  it("TopBar shows MOCK when transport is mock", () => {
    const html = renderToStaticMarkup(
      createElement(TopBar, {
        transportMode: "mock",
        simTimeMs: 60_000,
        wallElapsedMs: 12_000,
        connectionStatus: "open",
        speechSnapshot: {
          state: "idle",
          text: null,
          urgent: false,
          queuedUrgent: false,
          queuedRoutineCount: 0,
        },
      }),
    );
    expect(html).toContain("MOCK");
  });

  it("UrgentStrip uses callsign and alert role", () => {
    const html = renderToStaticMarkup(
      createElement(UrgentStrip, {
        report: {
          sequence: 1 as never,
          simTimeMs: 1000 as never,
          agentId: "scout" as never,
          text: "Fire crossing the road.",
          urgent: true,
        },
        callsign: "Scout",
        audioState: "pending",
        queuedUrgent: false,
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Scout");
  });

  it("ConnectionBanner is hidden when open", () => {
    expect(renderToStaticMarkup(createElement(ConnectionBanner, { status: "open" }))).toBe("");
  });

  it("DemoBanner describes demo mode", () => {
    expect(renderToStaticMarkup(createElement(DemoBanner, null))).toContain("Demo mode");
  });
});
