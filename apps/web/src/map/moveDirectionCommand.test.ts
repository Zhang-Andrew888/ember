import { describe, expect, it } from "vitest";
import {
  bearingToCompass,
  buildDirectionalDraft,
  buildMoveDirectionDraft,
  DEFAULT_TRAVEL_CAP_M,
  MAX_TRAVEL_M,
  worldDistanceMeters,
} from "./moveDirectionCommand.js";

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

  it("records the picked distance and uses the default limit for a short pick", () => {
    const draft = buildMoveDirectionDraft({ agentId: "crew-1", callsign: "Crew 1", from: { x: 400, y: 800 }, to: { x: 400, y: 950 } })!;
    expect(draft.pickedDistanceMeters).toBe(150);
    expect(draft.capMeters).toBe(DEFAULT_TRAVEL_CAP_M);
    expect(draft.capStated).toBe(false);
    expect(draft.cueTo).toEqual({ x: 400, y: 800 + DEFAULT_TRAVEL_CAP_M });
  });

  it("states a limit in the command only past the default, capped at the maximum", () => {
    const far = buildMoveDirectionDraft({ agentId: "crew-1", callsign: "Crew 1", from: { x: 0, y: 0 }, to: { x: 900, y: 0 } })!;
    expect(far.commandText).toBe("Crew 1, move east up to 900 meters and stop at the nearest safe road.");
    expect(far.capStated).toBe(true);
    const tooFar = buildMoveDirectionDraft({ agentId: "crew-1", callsign: "Crew 1", from: { x: 0, y: 0 }, to: { x: 5000, y: 0 } })!;
    expect(tooFar.capMeters).toBe(MAX_TRAVEL_M);
    expect(tooFar.pickedDistanceMeters).toBe(5000);
  });

  it("keeps the direction cue on the map", () => {
    const draft = buildMoveDirectionDraft({
      agentId: "crew-1",
      callsign: "Crew 1",
      from: { x: 1500, y: 800 },
      to: { x: 1590, y: 800 },
      worldMeters: 1600,
    })!;
    expect(draft.cueTo.x).toBe(1600);
  });

  it("builds the same command from a keyboard direction choice", () => {
    const draft = buildDirectionalDraft({ agentId: "crew-1", callsign: "Crew 1", from: { x: 400, y: 400 }, direction: "south", capMeters: 600 });
    expect(draft.commandText).toBe("Crew 1, move south and stop at the nearest safe road.");
    expect(draft.pickedDistanceMeters).toBeNull();
    expect(draft.cueTo.y).toBeCloseTo(-200);
    const longer = buildDirectionalDraft({ agentId: "crew-1", callsign: "Crew 1", from: { x: 400, y: 400 }, direction: "west", capMeters: 1200 });
    expect(longer.commandText).toBe("Crew 1, move west up to 1200 meters and stop at the nearest safe road.");
  });
});
