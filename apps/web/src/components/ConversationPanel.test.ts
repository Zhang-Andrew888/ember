import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConversationPanel, type ConversationPanelProps } from "./ConversationPanel.js";

const props: ConversationPanelProps = {
  transcript: [], activeRecipientCallsign: "Crew 1", composerDisabled: false, demoMode: false,
  onSendMessage: vi.fn(), onPttBegin: vi.fn(), onPttRelease: vi.fn(), onPttCancel: vi.fn(),
  speechSnapshot: { state: "idle", text: null, urgent: false, queuedUrgent: false, queuedRoutineCount: 0 },
};

describe("ConversationPanel", () => {
  it("explains sample capture honestly when live transcription is unavailable", () => {
    const html = renderToStaticMarkup(createElement(ConversationPanel, props));
    expect(html).toContain("Live voice is unavailable");
    expect(html).toContain("sample message");
    expect(html).toContain("Type a message…");
    expect(html).not.toContain("Capture: unknown");
  });
  it("distinguishes demo samples from live microphone recording", () => {
    const demo = renderToStaticMarkup(createElement(ConversationPanel, { ...props, demoMode: true }));
    const live = renderToStaticMarkup(createElement(ConversationPanel, { ...props, grokStt: async () => "Crew 1, hold" }));
    expect(demo).toContain("Practice voice");
    expect(demo).not.toContain("canned");
    expect(live).toContain("Hold to record your message; release to send.");
    expect(live).not.toContain("sample message");
  });
  it("keeps the composer disabled while connection is unavailable and renders rejection feedback", () => {
    const html = renderToStaticMarkup(createElement(ConversationPanel, { ...props, composerDisabled: true,
      transcript: [{ id: "rejected", kind: "rejection", simTimeMs: 1000, speaker: "Crew 1", text: "No safe route.", urgent: false }],
    }));
    expect(html).toContain("Waiting for connection…");
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain("Objective rejected");
    expect(html).toContain("No safe route.");
  });
});
