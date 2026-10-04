import { describe, expect, it } from "vitest";
import { colors } from "./colors.js";

/** Pure colour maths (WCAG 2.x relative luminance, HSL hue) so the palette rules are checkable. */
function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

describe("issue #122 - forecast and actual fire palette tokens", () => {
  it("forecast and observed fire are different tokens", () => {
    expect(colors.forecastEnvelope.toLowerCase()).not.toBe(colors.observedFire.toLowerCase());
  });

  it("forecast hue is far from observed-fire hue (not the old pale amber)", () => {
    expect(hueDistance(colors.forecastEnvelope, colors.observedFire)).toBeGreaterThanOrEqual(60);
    expect(hueDistance("#FFC98B", colors.observedFire)).toBeLessThan(60); // the old token, for contrast
  });

  it("forecast also stays apart from the other map hues (refuge, rejected, replay unseen)", () => {
    for (const other of [colors.refuge, colors.rejected, "#B79CFF"]) {
      expect(hueDistance(colors.forecastEnvelope, other), other).toBeGreaterThanOrEqual(30);
    }
  });

  it("forecast and observed fire both read against the background and the panel", () => {
    for (const token of [colors.forecastEnvelope, colors.observedFire]) {
      expect(contrast(token, colors.background)).toBeGreaterThanOrEqual(3);
      expect(contrast(token, colors.panel)).toBeGreaterThanOrEqual(3);
    }
  });
});
