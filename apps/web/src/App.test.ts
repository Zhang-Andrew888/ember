import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

// The browser-only external-store hook has no SSR snapshot. Keep its initial idle state here.
vi.mock("./state/useSpeechPlaybackStub.js", () => ({ useSpeechPlaybackStub: () => ({
  state: "idle", text: null, urgent: false, queuedUrgent: false, queuedRoutineCount: 0,
}) }));
vi.mock("./state/useCoordinatorView.js", () => ({ useCoordinatorView: () => ({
  status: "connecting", view: null, sideband: { transcripts: [], receipts: [], audioCues: [] },
}) }));
vi.mock("./components/scene/SceneView.js", () => ({ SceneView: () => null }));

describe("App briefing", () => {
  it("starts on the briefing with an explicit microphone check and no live composer", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain("Start incident");
    expect(html).toContain("Check microphone");
    expect(html).toContain("Not checked yet");
    expect(html).not.toContain("Grok Voice is connected");
    expect(html).not.toContain('id="composer-input"');
    expect(html).toContain("Crew 1");
  });
});
