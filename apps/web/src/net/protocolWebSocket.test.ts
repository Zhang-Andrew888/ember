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

    expect(send).toHaveBeenCalledOnce();
    const payload = JSON.parse(send.mock.calls[0]![0] as string) as {
      protocolVersion: number;
      message: { type: string; text: string };
    };
    expect(payload.protocolVersion).toBe(WIRE_PROTOCOL_VERSION);
    expect(payload.message).toEqual({ type: "say", text: "hello", idempotencyKey: "k1" });
  });
});
