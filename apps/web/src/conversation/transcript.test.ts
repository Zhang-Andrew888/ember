import { describe, it, expect } from "vitest";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { buildConversationTranscript, appendSideband, EMPTY_SIDEBAND } from "./transcript.js";

describe("conversation/transcript", () => {
  it("includes routine agent reports with callsigns", () => {
    const lines = buildConversationTranscript(fixtureCoordinatorView, EMPTY_SIDEBAND);
    expect(lines.some((line) => line.kind === "agent_report" && line.speaker === "Crew 1")).toBe(true);
  });

  it("merges clarification receipts into the transcript", () => {
    const sideband = appendSideband(EMPTY_SIDEBAND, {
      type: "receipt",
      receipt: {
        commandId: "cmd-1" as never,
        status: "clarification_required",
        recipientId: null,
        appliedTick: null,
        explanation: "Need a named recipient.",
        planRevision: null,
      },
      reply: "Which crew should receive this?",
    });
    const lines = buildConversationTranscript(fixtureCoordinatorView, sideband);
    expect(lines.some((line) => line.kind === "clarification" && line.text.includes("Which crew"))).toBe(true);
  });
});
