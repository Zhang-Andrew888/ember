import { incidentWebSocketProtocols } from "@ember/domain";
import type { WebSocketLike } from "./CoordinatorViewClient.js";
import { encodeClient, type OutboundClientMessage } from "./wireProtocol.js";

export interface ProtocolWebSocket extends WebSocketLike {
  sendCommand(message: OutboundClientMessage): void;
}

/** Live WebSocket that wraps outbound frames in protocol v1 client envelopes. */
export function createProtocolWebSocket(url: string, token: string | undefined): ProtocolWebSocket {
  if (token === undefined) throw new Error("Missing incident WebSocket token");
  const target = new URL(url);
  if (target.searchParams.has("token")) {
    throw new Error("Configure the incident token separately from the WebSocket URL");
  }
  const ws = new WebSocket(target.href, incidentWebSocketProtocols(token));
  const wrapper = {
    get readyState() {
      return ws.readyState;
    },
    close() {
      ws.close();
    },
    sendCommand(message: OutboundClientMessage) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encodeClient(message));
      }
    },
  } as ProtocolWebSocket;

  for (const key of ["onopen", "onclose", "onerror", "onmessage"] as const) {
    Object.defineProperty(wrapper, key, {
      enumerable: true,
      configurable: true,
      get() {
        return ws[key];
      },
      set(handler) {
        ws[key] = handler;
      },
    });
  }

  return wrapper;
}
