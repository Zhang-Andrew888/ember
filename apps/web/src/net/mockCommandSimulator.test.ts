import { describe, it, expect } from "vitest";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { mockWireRepliesForSay } from "./mockCommandSimulator.js";
import { parseServerWireMessage } from "./serverWireParse.js";

describe("net/mockCommandSimulator", () => {
  it("returns a status transcript and accepted receipt for status queries", () => {
    const frames = mockWireRepliesForSay("status", 10_000, "cmd-a");
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const transcript = parseServerWireMessage(frames[0]!);
    expect(transcript?.type).toBe("transcript");
  });

  it("returns clarification when no named recipient", () => {
    const frames = mockWireRepliesForSay("hold position", 10_000, "cmd-b");
    const receipt = parseServerWireMessage(frames[0]!);
    expect(receipt?.type).toBe("receipt");
    if (receipt?.type === "receipt") {
      expect(receipt.receipt.status).toBe("clarification_required");
    }
  });

  it("accepts directional movement orders after received", () => {
    const frames = mockWireRepliesForSay("Crew 1, move northeast and stop at the nearest safe road.", 0, "cmd-move");
    expect(frames.length).toBe(2);
    expect(frames[1]).toContain("\"accepted\"");
  });

  it("returns rejected for invalid objective phrasing", () => {
    const frames = mockWireRepliesForSay("Crew 2, invalid objective", 10_000, "cmd-c");
    const receipt = parseServerWireMessage(frames[0]!);
    if (receipt?.type === "receipt") {
      expect(receipt.receipt.status).toBe("rejected");
    }
  });

  it("never mentions a scout in its status reply or clarification (#118)", () => {
    const status = mockWireRepliesForSay("status", 10_000, "cmd-d");
    const clarification = mockWireRepliesForSay("hold position", 10_000, "cmd-e");
    for (const frame of [...status, ...clarification]) expect(frame.toLowerCase()).not.toContain("scout");
  });

  it("does not accept a scout as a recipient: naming one asks which crew", () => {
    const frames = mockWireRepliesForSay("Scout, relay fire on the north road", 10_000, "cmd-f");
    const receipt = parseServerWireMessage(frames[0]!);
    expect(receipt?.type).toBe("receipt");
    if (receipt?.type === "receipt") expect(receipt.receipt.status).toBe("clarification_required");
  });
  it("reports the displayed crew states instead of inventing an approaching crew", () => {
    for (const state of ["working", "lost", "idle"] as const) {
      const view = { ...fixtureCoordinatorView, agents: [{ ...fixtureCoordinatorView.agents[0]!, state }] };
      const [frame] = mockWireRepliesForSay("Crew 1, status report", 100_000, "status-current", view);
      const message = parseServerWireMessage(frame!);
      expect(message).toMatchObject({ type: "transcript", text: `Crew 1 ${state}` });
    }
  });

  it("uses the reported return phase and admits when no view is available", () => {
    const view = { ...fixtureCoordinatorView, agentPlans: fixtureCoordinatorView.agentPlans.map((plan) => ({ ...plan, phase: "return" as const })) };
    expect(mockWireRepliesForSay("status", 0, "returning", view)[0]).toContain("Crew 1 returning");
    expect(mockWireRepliesForSay("status", 0, "empty")[0]).toContain("Waiting for the first crew status report");
  });

});
