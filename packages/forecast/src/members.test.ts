import { describe, expect, it } from "vitest";
import type { ForecastMember, MemberKind } from "./types.js";
import { capSupportedMembers } from "./members.js";

function member(id: string, kind: MemberKind, spreadMultiplier: number, ignition: number[]): ForecastMember {
  return {
    id,
    kind,
    params: { spreadMultiplier, initialWindRad: 0, windShiftMs: 1e9, postShiftWindRad: 1 },
    ignitionMs: Float64Array.from(ignition),
    rolloutEndMs: 600_000,
  };
}

describe("supported member cap", () => {
  it("preserves dangerous interior hypotheses even when they exceed member and runtime caps", () => {
    const supported = [
      member("boundary-low", "boundary", 0.7, [0, 500, 500]),
      member("redundant", "rebuilt", 0.9, [0, 600, 600]),
      { ...member("early-east", "rebuilt", 1.0, [0, 100, 500]), weight: 0.0001 },
      member("early-west", "rebuilt", 1.1, [0, 500, 100]),
      member("boundary-high", "boundary", 1.3, [0, 500, 500]),
    ];

    const kept = capSupportedMembers(supported, 2, 2);
    expect(kept.map((m) => m.id)).toEqual(["boundary-low", "early-east", "early-west", "boundary-high"]);
    expect(kept.length).toBeGreaterThan(2);
    for (let cell = 0; cell < 3; cell++) {
      expect(Math.min(...kept.map((m) => m.ignitionMs[cell]!))).toBe(
        Math.min(...supported.map((m) => m.ignitionMs[cell]!)),
      );
    }
  });
});
