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

  const wire = (kind: "coordinator" | "control" | "agent" | "system", text: string, simTimeMs: number, urgent = false) =>
    ({ type: "transcript", kind, text, simTimeMs, urgent }) as const;
  const receipt = (reply: string) =>
    ({
      type: "receipt",
      receipt: {
        commandId: "cmd-1" as never,
        status: "accepted",
        recipientId: null,
        appliedTick: 5000 as never,
        explanation: "ok",
        planRevision: null,
      },
      reply,
    }) as const;

  it("drops routine wire agent lines that repeat the agent's report, but keeps urgent ones", () => {
    let sideband = appendSideband(EMPTY_SIDEBAND, wire("agent", "Crew 1 is heading to Community Lodge (work 540 s).", 1000));
    sideband = appendSideband(sideband, wire("agent", "Crew 1 is withdrawing. Waiting here is no longer safe.", 2000, true));
    const lines = buildConversationTranscript(fixtureCoordinatorView, sideband);
    expect(lines.some((line) => line.text.includes("heading to Community Lodge"))).toBe(false);
    const urgent = lines.find((line) => line.text.includes("withdrawing"));
    expect(urgent?.speaker).toBe("Crew 1");
  });

  it("names authors for display and never shows the raw wire kind", () => {
    let sideband = appendSideband(EMPTY_SIDEBAND, wire("coordinator", "Crew 2, protect Waterworks", 5000));
    sideband = appendSideband(sideband, wire("system", "The incident has ended.", 6000));
    const lines = buildConversationTranscript(fixtureCoordinatorView, sideband);
    expect(lines.find((line) => line.text.startsWith("Crew 2,"))?.speaker).toBe("You");
    expect(lines.find((line) => line.text.startsWith("The incident"))?.speaker).toBe("System");
  });

  it("shows the player's message before the reply to it, and one copy of the reply", () => {
    const reply = "Sent to Crew 2: protect Waterworks.";
    let sideband = appendSideband(EMPTY_SIDEBAND, wire("control", reply, 5000));
    sideband = appendSideband(sideband, wire("coordinator", "Crew 2, protect Waterworks", 5000));
    sideband = appendSideband(sideband, receipt(reply));
    const lines = buildConversationTranscript(fixtureCoordinatorView, sideband).filter((line) => line.kind !== "agent_report");
    expect(lines.map((line) => line.speaker)).toEqual(["You", "Control"]);
    expect(lines.filter((line) => line.text === reply)).toHaveLength(1);
  });
});
