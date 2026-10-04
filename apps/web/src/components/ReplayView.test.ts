import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReplayView } from "./ReplayView.js";
import { mockRecording } from "../replay/mockRecording.js";
import { buildSceneEntities } from "./scene/sceneEntities.js";
import { scenarioMap } from "../map/activeScenario.js";
import type { SceneViewProps } from "./scene/SceneView.js";

const scene = vi.hoisted(() => vi.fn<(props: SceneViewProps) => null>(() => null));
vi.mock("./scene/SceneView.js", () => ({ SceneView: scene }));

describe("ReplayView", () => {
  it("starts with recorded coordinator knowledge and commands disabled", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { onExit: vi.fn(), source: "incident", recording: mockRecording }));
    expect(html).toContain("This run.");
    expect(html).toContain("Commands disabled.");
    expect(html).not.toContain("Illustrative recording");
    const rendered = scene.mock.calls.at(-1)?.[0];
    expect(rendered?.entities.fireCells).toEqual(buildSceneEntities(mockRecording.coordinatorLog[0]!, scenarioMap).fireCells);
    expect(rendered?.mapAssignMode).toBe(false);
    expect(html).not.toContain('checked=""');
  });
  it("identifies the illustrative recording separately from the user's run", () => {
    const html = renderToStaticMarkup(createElement(ReplayView, { onExit: vi.fn(), source: "illustrative" }));
    expect(html).toContain("Illustrative recording, not from this run.");
    expect(html).toContain("Exit replay");
  });
});
