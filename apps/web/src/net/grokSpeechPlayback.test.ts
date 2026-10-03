import { describe, expect, it } from "vitest";
import { acknowledgeAfterPlayback } from "./grokSpeechPlayback.js";
import type { SpeechPlaybackOutcome } from "./wireProtocol.js";

describe("acknowledgeAfterPlayback", () => {
  it("reports ended when playback completes", async () => {
    const reports: Array<{ itemId: string; outcome: SpeechPlaybackOutcome }> = [];
    await acknowledgeAfterPlayback(
      "one",
      async () => "ended",
      (itemId, outcome) => reports.push({ itemId, outcome }),
    );
    expect(reports).toEqual([{ itemId: "one", outcome: "ended" }]);
  });

  it("reports failed when playback returns failed or throws", async () => {
    const reports: SpeechPlaybackOutcome[] = [];
    await acknowledgeAfterPlayback("one", async () => "failed", (_id, outcome) => reports.push(outcome));
    await acknowledgeAfterPlayback(
      "two",
      async () => {
        throw new Error("playback failed");
      },
      (_id, outcome) => reports.push(outcome),
    );
    expect(reports).toEqual(["failed", "failed"]);
  });
});
