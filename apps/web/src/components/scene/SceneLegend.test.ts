import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SceneLegend, type SceneLegendProps } from "./SceneLegend.js";
import type { ForecastLayer } from "./sceneLayers.js";
import { colors } from "../../styles/colors.js";

const noop = () => {};

function forecast(reliability: ForecastLayer["reliability"]): ForecastLayer {
  return {
    reliability,
    supportedMemberCount: 12,
    explanation: reliability === "reliable" ? null : "few supported scenarios",
    bands: [],
    trusted: reliability === "reliable",
    headline:
      reliability === "reliable"
        ? "Forecast reliable (12 supported scenarios)"
        : reliability === "unreliable"
          ? "Forecast unreliable: treat bands as unknown"
          : "Forecast rebuilding: bands may change",
  } as ForecastLayer;
}

function legend(overrides: Partial<SceneLegendProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SceneLegend, {
      showFireCells: true,
      onToggleFireCells: noop,
      showCurrentFire: true,
      onToggleCurrentFire: noop,
      currentFire: null,
      showRoutes: true,
      onToggleRoutes: noop,
      showForecast: true,
      onToggleForecast: noop,
      forecast: forecast("reliable"),
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

describe("issue #122 - legend separates forecast from actual fire", () => {
  it("lists observed fire and forecast as separate entries with different swatches", () => {
    const html = legend();
    expect(html).toContain('data-key="observed-fire"');
    expect(html).toContain('data-key="forecast"');
    const fireSwatch = html.match(/data-key="observed-fire"><span[^>]*style="([^"]*)"/)?.[1] ?? "";
    expect(fireSwatch.toLowerCase()).toContain(colors.observedFire.toLowerCase());
    // The forecast swatch is the hatch pattern class (a non-colour cue), not a flat fire-coloured box.
    expect(html).toMatch(/data-key="forecast"><span class="scene-legend__swatch scene-legend__swatch--hatch"/);
  });

  it("keeps a text label for the hatch pattern so the cue is not colour alone", () => {
    const html = legend();
    expect(html).toContain("Forecast envelope: magenta hatching");
    expect(html).toContain("Show forecast");
  });

  it("explains the faint, labelled unreliable state in the key", () => {
    const html = legend();
    expect(html).toContain('data-key="forecast-unreliable"');
    expect(html).toContain("scene-legend__swatch--hatch-faint");
    expect(html).toContain("unreliable");
  });

  it.each(["reliable", "unreliable", "rebuilding"] as const)("reliability state %s stays identifiable", (reliability) => {
    const html = legend({ forecast: forecast(reliability) });
    expect(html).toContain(`data-reliability="${reliability}"`);
    expect(html).toContain(forecast(reliability).headline);
  });

  it("the three reliability headlines are distinct", () => {
    const headlines = new Set((["reliable", "unreliable", "rebuilding"] as const).map((r) => forecast(r).headline));
    expect(headlines.size).toBe(3);
  });

  it("says so when no forecast has been built", () => {
    const html = legend({ forecast: null });
    expect(html).toContain('data-reliability="none"');
    expect(html).toContain("Forecast: not yet built");
  });

  it("offers an accessible map tile inspector (#125)", () => {
    const html = legend();
    expect(html).toContain("Inspect map tile");
    expect(html).toContain("Inspect tile");
    expect(html).toContain("Grid index");
  });
});
