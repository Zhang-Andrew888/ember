import type { CoordinatorView } from "@ember/domain";
import { EMPTY_SIDEBAND, appendSideband, retainReports, type WireSidebandState } from "../conversation/transcript.js";
import { applyIncomingView } from "../state/viewReducer.js";
import { parseCoordinatorViewFrame } from "./wireProtocol.js";
import { parseServerWireMessage } from "./serverWireParse.js";

/**
 * Minimal subset of the browser WebSocket API this client needs. Injectable
 * so tests (and the Slice-1 dev harness) can supply a fake implementation
 * instead of a real socket - see net/mockIncidentSocket.ts.
 */
export interface WebSocketLike {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  readonly readyState: number;
  close(): void;
}

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

export interface CoordinatorViewClientState {
  readonly status: ConnectionStatus;
  readonly view: CoordinatorView | null;
  readonly sideband: WireSidebandState;
}

export interface CoordinatorViewClient {
  getState(): CoordinatorViewClientState;
  subscribe(listener: () => void): () => void;
  /** Stops reconnecting and closes the current socket. */
  close(): void;
}

/**
 * Parses one incoming WS text frame. Accepts either a bare CoordinatorView
 * payload or a `{ type: "coordinator_view", view }` envelope, since
 * docs/ARCHITECTURE.md reserves the WS channel for other message kinds
 * (receipts, audio metadata) that a coordinator-view client should ignore
 * rather than reject the connection over.
 */
export function parseIncomingMessage(raw: string): CoordinatorView | null {
  return parseCoordinatorViewFrame(raw);
}

const RECONNECT_DELAY_MS = 1000;

export function createCoordinatorViewClient(
  openSocket: () => WebSocketLike,
  options: { reconnectDelayMs?: number } = {},
): CoordinatorViewClient {
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  const listeners = new Set<() => void>();
  let state: CoordinatorViewClientState = { status: "connecting", view: null, sideband: EMPTY_SIDEBAND };
  let socket: WebSocketLike | null = null;
  let closedByClient = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(next: CoordinatorViewClientState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function scheduleReconnect(): void {
    if (closedByClient || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  }

  function connect(): void {
    setState({ status: "connecting", view: state.view, sideband: state.sideband });
    const nextSocket = openSocket();
    socket = nextSocket;

    nextSocket.onopen = () => {
      if (socket !== nextSocket) return;
      setState({ status: "open", view: state.view, sideband: state.sideband });
    };

    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket) return;
      const wire = parseServerWireMessage(event.data);
      if (wire === null) {
        const incoming = parseIncomingMessage(event.data);
        if (!incoming) return;
        setState({
          status: "open",
          view: applyIncomingView(state.view, incoming),
          sideband: retainReports(state.sideband, incoming),
        });
        return;
      }
      if (wire.type === "view") {
        setState({
          status: "open",
          view: applyIncomingView(state.view, wire.view),
          sideband: retainReports(state.sideband, wire.view),
        });
        return;
      }
      const arrivalSimTimeMs = state.view === null ? 0 : (state.view.simTimeMs as number);
      setState({
        status: "open",
        view: state.view,
        sideband: appendSideband(state.sideband, wire, arrivalSimTimeMs),
      });
    };

    nextSocket.onerror = () => {
      if (socket !== nextSocket) return;
      setState({ status: "error", view: state.view, sideband: state.sideband });
    };

    nextSocket.onclose = () => {
      if (socket !== nextSocket) return;
      setState({ status: "closed", view: state.view, sideband: state.sideband });
      scheduleReconnect();
    };
  }

  connect();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      closedByClient = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    },
  };
}
