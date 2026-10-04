import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colors } from "../../apps/web/src/styles/colors.js";

// The web package has no Node types and Vitest does not return CSS text, so the stylesheet is checked from here.
const css = readFileSync(join(import.meta.dirname, "../../apps/web/src/styles/global.css"), "utf8");

describe("issue #122 - global.css forecast tokens match colors.ts", () => {
  it("exposes the same fire and forecast tokens", () => {
    expect(css).toContain(`--color-forecast: ${colors.forecastEnvelope.toLowerCase()};`);
    expect(css).toContain(`--color-observed-fire: ${colors.observedFire.toLowerCase()};`);
  });

  it("keeps no hard-coded amber forecast colour", () => {
    expect(css.toLowerCase()).not.toContain("#ffc98b");
    expect(css).not.toContain("255, 201, 139");
  });

  it("forecast map labels keep a dashed border (non-colour cue) in the forecast colour", () => {
    const rule = css.match(/\.scene-label--forecast\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("border-style: dashed");
    expect(rule).toContain("var(--color-forecast)");
  });

  it("legend swatches use the forecast token for the hatch and the faint unreliable hatch", () => {
    for (const selector of [".scene-legend__swatch--hatch", ".scene-legend__swatch--hatch-faint"]) {
      const rule = css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(rule, selector).toContain("var(--color-forecast)");
    }
  });
});
