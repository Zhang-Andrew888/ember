import { describe, expect, it } from "vitest";
import { decodeClient } from "../../../../apps/server/src/protocol.js";
import { encodeClient, type OutboundClientMessage } from "./wireProtocol.js";

describe("web wire encodes messages the server accepts", () => {
  it("speech_playback from the Grok client passes ClientMessage validation", () => {
    const message: OutboundClientMessage = {
      type: "speech_playback",
      itemId: "sp-42",
      outcome: "ended",
    };
    const parsed = decodeClient(encodeClient(message));
    expect(parsed).toEqual(message);
  });

  it("speech_playback failed outcome is accepted", () => {
    const message: OutboundClientMessage = {
      type: "speech_playback",
      itemId: "sp-99",
      outcome: "failed",
    };
    expect(decodeClient(encodeClient(message))).toEqual(message);
  });
});
