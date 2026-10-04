import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SceneLegend, type SceneLegendProps } from "./SceneLegend.js";

const noop = () => {};

function legend(overrides: Partial<SceneLegendProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SceneLegend, {
      showFireCells: true,
      onToggleFireCells: noop,
      showCurrentFire: true,
      onToggleCurrentFire: noop,
      currentFire: { simTimeMs: 90_000, burningCount: 40, burnedCount: 12 },
      showRoutes: true,
      onToggleRoutes: noop,
      showForecast: true,
      onToggleForecast: noop,
      forecast: null,
      canFollow: false,
      follow: false,
      onToggleFollow: noop,
      onResetCamera: noop,
      fireCells: [],
      onInspectCell: noop,
      onInspectMapTile: noop,
      ...overrides,
    }),
  );
}

describe("issue #114 - legend separates current fire, observed belief and forecast", () => {
  it("lists current fire, burned out, observed belief and forecast as four different entries", () => {
    const html = legend();
    expect(html).toContain('data-key="current-fire"');
    expect(html).toContain('data-key="current-burned"');
    expect(html).toContain('data-key="observed-belief"');
    expect(html).toContain("scene-legend__swatch--belief");
    expect(html).toContain("scene-legend__swatch--hatch");
    expect(html).toContain("Forecast envelope");
  });

  it("states the live current fire summary in incident time", () => {
    const html = legend();
    expect(html).toContain("Current fire at 1:30 incident time: 40 burning,");
    expect(html).toContain("12 burned");
  });

  it("offers a current-fire toggle that is separate from observations and forecast", () => {
    const html = legend();
    expect(html).toContain("Show current fire");
    expect(html).toContain("Show fire observations");
    expect(html).toContain("Show forecast");
  });

  it("forecast stays toggleable: its checkbox follows showForecast", () => {
    expect(legend({ showForecast: true })).toMatch(/<input type="checkbox" checked=""[^>]*\/>\s*Show forecast/);
    expect(legend({ showForecast: false })).toMatch(/<input type="checkbox"(?! checked)[^>]*\/>\s*Show forecast/);
  });

  it("with no current fire in the feed it shows the plain observed-fire key and no current-fire controls", () => {
    const html = legend({ currentFire: null });
    expect(html).not.toContain('data-key="current-fire"');
    expect(html).not.toContain("Show current fire");
    expect(html).not.toContain("Current fire at");
    expect(html).toContain("Observed fire");
    expect(html).toContain("Show fire observations");
  });
});
