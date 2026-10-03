import { describe, it, expect } from "vitest";
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

  it("returns rejected for invalid objective phrasing", () => {
    const frames = mockWireRepliesForSay("Crew 2, invalid objective", 10_000, "cmd-c");
    const receipt = parseServerWireMessage(frames[0]!);
    if (receipt?.type === "receipt") {
      expect(receipt.receipt.status).toBe("rejected");
    }
  });
});
