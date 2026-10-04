import { describe, expect, it } from "vitest";
import { presentNotice } from "./notices.js";

describe("presentNotice", () => {
  it("never shows the server command id for still_interpreting", () => {
    const shown = presentNotice({ kind: "still_interpreting", detail: "cmd-42" });
    expect(shown.text).not.toContain("cmd-42");
    expect(shown.clearsOnReply).toBe(true);
  });

  it("offers the unsent words back for unsent_utterance", () => {
    const shown = presentNotice({ kind: "unsent_utterance", detail: "  Crew 1, hold at the bridge " });
    expect(shown.text).toContain("Crew 1, hold at the bridge");
    expect(shown.restorableText).toBe("Crew 1, hold at the bridge");
  });

  it("has nothing to restore for an empty unsent utterance", () => {
    expect(presentNotice({ kind: "unsent_utterance", detail: " " }).restorableText).toBeNull();
  });

  it("presents server failures as errors with user copy", () => {
    for (const kind of ["technical_failure", "backpressure"] as const) {
      const shown = presentNotice({ kind, detail: "internal stack trace" });
      expect(shown.tone).toBe("error");
      expect(shown.text).not.toContain("stack trace");
    }
    expect(presentNotice({ kind: "bad_message", detail: "x" }).tone).toBe("warning");
  });
});
