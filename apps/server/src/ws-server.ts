import { WebSocketServer } from "ws";
import { ConversationBridge } from "./conversation.js";
import { LiveRun, SessionHub, type ClientId } from "./hub.js";
import { IncidentSession, type SessionOptions } from "./session.js";

export interface ServerHandle {
  readonly port: number;
  readonly live: LiveRun;
  readonly hub: SessionHub;
  readonly session: IncidentSession;
  close(): Promise<void>;
}

const FLUSH_EVERY_MS = 200;
/** Coordinator commands are short text; anything larger is refused by closing the socket (1009). */
const MAX_MESSAGE_BYTES = 64 * 1024;

/**
 * Bind the hub to a WebSocket server on the loopback interface. The simulation advances on the
 * monotonic clock every 200 ms regardless of client count or speed; a slow client only delays its
 * own messages. Provider keys never reach this process's sockets: only sanitized messages do.
 */
export async function startServer(options: SessionOptions & { port?: number }): Promise<ServerHandle> {
  const session = new IncidentSession(options);
  const bridge = new ConversationBridge(session);
  const hub = new SessionHub(session, bridge);
  const live = new LiveRun(session, bridge, hub, { nowMs: () => performance.now() });
  const wss = new WebSocketServer({ port: options.port ?? 0, host: "127.0.0.1", maxPayload: MAX_MESSAGE_BYTES });
  await new Promise<void>((resolve) => wss.on("listening", resolve));
  const sockets = new Map<ClientId, { send(data: string): void }>();
  wss.on("connection", (socket) => {
    const id = hub.connect();
    sockets.set(id, socket);
    socket.on("message", (data) => hub.handle(id, data.toString(), live.wallElapsedMs));
    socket.on("error", () => {
      // A protocol error (such as an oversized frame) closes the socket; "close" does the cleanup.
    });
    socket.on("close", () => {
      hub.disconnect(id, live.wallElapsedMs);
      sockets.delete(id);
    });
    flush();
  });
  const flush = (): void => {
    for (const [id, socket] of sockets) for (const m of hub.drain(id)) socket.send(m);
  };
  live.start();
  const timer = setInterval(() => {
    live.pump();
    flush();
  }, FLUSH_EVERY_MS);
  const address = wss.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port,
    live,
    hub,
    session,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        wss.close(() => resolve());
      }),
  };
}
