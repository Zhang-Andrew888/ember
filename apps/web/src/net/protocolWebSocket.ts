import type { WebSocketLike } from "./CoordinatorViewClient.js";
import { encodeClient, type OutboundClientMessage } from "./wireProtocol.js";

export interface ProtocolWebSocket extends WebSocketLike {
  sendCommand(message: OutboundClientMessage): void;
}

/** Live WebSocket that wraps outbound frames in protocol v1 client envelopes. */
export function createProtocolWebSocket(url: string): ProtocolWebSocket {
  const ws = new WebSocket(url);
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
