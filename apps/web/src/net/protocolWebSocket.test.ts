import { describe, it, expect, vi, afterEach } from "vitest";
import { createProtocolWebSocket } from "./protocolWebSocket.js";
import { WIRE_PROTOCOL_VERSION } from "@ember/domain";

describe("net/protocolWebSocket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps auth out of the URL and sends it separately on every connection", () => {
    const opened: Array<{ url: string; protocols: string[] }> = [];
    class FakeWebSocket {
      constructor(url: string, protocols: string[]) { opened.push({ url, protocols }); }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const url = "ws://localhost:3000/incidents/abc/events";
    const token = "b".repeat(48);
    createProtocolWebSocket(url, token);
    createProtocolWebSocket(url, token);
    expect(opened).toEqual(Array.from({ length: 2 }, () => ({ url, protocols: ["ember.v1", `ember.token.${token}`] })));
  });

  it("rejects missing tokens and legacy credential URLs before opening a socket", () => {
    const open = vi.fn();
    vi.stubGlobal("WebSocket", open);
    expect(() => createProtocolWebSocket("ws://localhost/events", undefined)).toThrow("Missing incident WebSocket token");
    expect(() => createProtocolWebSocket("ws://localhost/events?token=secret", "a".repeat(48))).toThrow("Configure the incident token separately");
    expect(() => createProtocolWebSocket("ws://localhost/events", "secret")).toThrow("Invalid incident WebSocket token");
    expect(open).not.toHaveBeenCalled();
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

    const socket = createProtocolWebSocket("ws://example.test/events", "a".repeat(48));
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
