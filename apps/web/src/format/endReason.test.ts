import { describe, it, expect } from "vitest";
import type { EndReason } from "@ember/domain";
import { endReasonDisplayText } from "./endReason.js";

describe("format/endReason - endReasonDisplayText", () => {
  const reasons: EndReason[] = [
    "time_expired",
    "fire_extinguished",
    "all_sites_resolved",
    "all_protection_crews_lost",
  ];

  it("gives every EndReason a distinct, non-empty sentence", () => {
    const texts = reasons.map(endReasonDisplayText);
    expect(texts.every((text) => text.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(reasons.length);
  });

  it("describes all_protection_crews_lost as a loss, not a routine end", () => {
    expect(endReasonDisplayText("all_protection_crews_lost")).toMatch(/lost/i);
  });
});
