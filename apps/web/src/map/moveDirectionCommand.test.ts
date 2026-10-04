import { describe, expect, it } from "vitest";
import { bearingToCompass, buildMoveDirectionDraft, worldDistanceMeters } from "./moveDirectionCommand.js";

describe("moveDirectionCommand", () => {
  it("maps bearings to compass sectors", () => {
    expect(bearingToCompass(0, 100)).toBe("north");
    expect(bearingToCompass(100, 0)).toBe("east");
    expect(bearingToCompass(-100, 100)).toBe("northwest");
  });

  it("builds a reviewable say line with direction and safe-road stop", () => {
    const draft = buildMoveDirectionDraft({
      agentId: "crew-1",
      callsign: "Crew 1",
      from: { x: 400, y: 800 },
      to: { x: 400, y: 950 },
    });
    expect(draft).not.toBeNull();
    expect(draft!.commandText).toBe("Crew 1, move north and stop at the nearest safe road.");
    expect(draft!.direction).toBe("north");
    expect(worldDistanceMeters(draft!.from, draft!.to)).toBeGreaterThanOrEqual(25);
  });

  it("rejects picks too close to the crew", () => {
    expect(
      buildMoveDirectionDraft({
        agentId: "crew-1",
        callsign: "Crew 1",
        from: { x: 400, y: 800 },
        to: { x: 410, y: 805 },
      }),
    ).toBeNull();
  });
});
