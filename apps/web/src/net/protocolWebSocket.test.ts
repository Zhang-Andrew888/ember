import { describe, it, expect, vi, afterEach } from "vitest";
import { createProtocolWebSocket } from "./protocolWebSocket.js";
import { WIRE_PROTOCOL_VERSION } from "@ember/domain";

describe("net/protocolWebSocket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sendCommand wraps messages in protocol v1 envelopes", () => {
    const send = vi.fn();
    class FakeWebSocket {
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      onopen = null;
      onclose = null;
      onerror = null;
      onmessage = null;
      send = send;
      close = vi.fn();
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const socket = createProtocolWebSocket("ws://example.test/events");
    socket.sendCommand({ type: "say", text: "hello", idempotencyKey: "k1" });
    socket.sendCommand({ type: "speech_playback", itemId: "sp-1", outcome: "ended" });

    expect(send).toHaveBeenCalledTimes(2);
    const say = JSON.parse(send.mock.calls[0]![0] as string) as {
      protocolVersion: number;
      message: { type: string; text: string };
    };
    expect(say.protocolVersion).toBe(WIRE_PROTOCOL_VERSION);
    expect(say.message).toEqual({ type: "say", text: "hello", idempotencyKey: "k1" });
    const playback = JSON.parse(send.mock.calls[1]![0] as string) as {
      message: { type: string; itemId: string; outcome: string };
    };
    expect(playback.message).toEqual({ type: "speech_playback", itemId: "sp-1", outcome: "ended" });
  });
});
