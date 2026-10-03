import Fastify from "fastify";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { WIRE_PROTOCOL_VERSION } from "@ember/domain";
import { IncidentRegistry } from "./incident-registry.js";
import { stopReplayWorker } from "./replay-offloop.js";
import { grokIntentEnabled, grokVoiceEnabled } from "./xai/env.js";
import { transcribeAudio } from "./xai/stt.js";
import type { MonotonicClock } from "./runner.js";
import type { ClientId } from "./hub.js";

const FLUSH_EVERY_MS = 200;
const MAX_MESSAGE_BYTES = 64 * 1024;
/** How long a peer may take to finish a close handshake before the socket is destroyed. */
const SHUTDOWN_GRACE_MS = 1_000;

/**
 * `WebSocketServer.close()` in noServer mode does not drop clients; it waits until the set is empty.
 * Ask each socket to close, then destroy anything still open so shutdown cannot wait forever.
 */
function closeWebSockets(wss: WebSocketServer, open: Iterable<WebSocket>): Promise<void> {
  const tracked = [...open];
  for (const ws of tracked) ws.close(1001, "shutdown");
  return new Promise((resolve) => {
    let settled = false;
    const timers: unknown[] = [];
    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      resolve();
    };
    timers.push(
      setTimeout(() => {
        for (const ws of tracked) ws.terminate();
      }, SHUTDOWN_GRACE_MS),
    );
    timers.push(setTimeout(finish, SHUTDOWN_GRACE_MS * 2));
    wss.close(() => finish());
  });
}

export interface HttpAppHandle {
  readonly port: number;
  readonly registry: IncidentRegistry;
  close(): Promise<void>;
}

function parseIncidentPath(url: string | undefined): { kind: "events" | "voice"; incidentId: string } | null {
  if (url === undefined) return null;
  const m = /^\/incidents\/([^/]+)\/(events|voice)$/.exec(url.split("?")[0] ?? "");
  if (m === null) return null;
  return { incidentId: decodeURIComponent(m[1]!), kind: m[2] as "events" | "voice" };
}

function tokenFromQuery(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const q = url.split("?")[1];
  if (q === undefined) return undefined;
  return new URLSearchParams(q).get("token") ?? undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * Fastify HTTP routes plus WebSocket upgrade for `/incidents/:id/events` and `/incidents/:id/voice`.
 * Voice uses the same validated JSON push-to-talk messages as events (provider audio is future work).
 */
export async function startHttpApp(options: { port?: number; clock?: MonotonicClock; seed?: string } = {}): Promise<HttpAppHandle> {
  const clock: MonotonicClock = options.clock ?? { nowMs: () => performance.now() };
  const registry = new IncidentRegistry(options.seed);
  const fastify = Fastify({ logger: false });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const sockets = new Map<WebSocket, { clientId: ClientId; record: NonNullable<ReturnType<IncidentRegistry["get"]>> }>();
  let closing = false;

  fastify.get("/health", async () => ({
    ok: true as const,
    protocolVersion: WIRE_PROTOCOL_VERSION,
    grokVoice: grokVoiceEnabled(),
    grokIntent: grokIntentEnabled(),
  }));

  fastify.post("/incidents", async () => {
    const record = registry.create({}, clock);
    const view = registry.briefingView(record);
    return {
      incidentId: record.id,
      token: record.token,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      briefing: view,
      websocket: {
        events: `/incidents/${record.id}/events?token=${record.token}`,
        voice: `/incidents/${record.id}/voice?token=${record.token}`,
      },
    };
  });

  fastify.post<{ Params: { id: string } }>("/incidents/:id/start", async (req, reply) => {
    const token = req.headers["x-incident-token"];
    const record = registry.authorize(req.params.id, typeof token === "string" ? token : undefined);
    if (record === undefined) return reply.code(401).send({ error: "unauthorized" });
    registry.start(record);
    return { started: true, simTimeMs: record.session.incident.simTimeMs };
  });

  fastify.get<{ Params: { id: string; itemId: string } }>(
    "/incidents/:id/speech/:itemId",
    async (req, reply) => {
      const token = req.headers["x-incident-token"];
      const record = registry.authorize(req.params.id, typeof token === "string" ? token : undefined);
      if (record === undefined) return reply.code(401).send({ error: "unauthorized" });
      const bytes = record.speechStore.get(req.params.itemId);
      if (bytes === undefined) return reply.code(404).send({ error: "not_ready" });
      return reply.header("content-type", "audio/mpeg").send(Buffer.from(bytes));
    },
  );

  fastify.post<{ Params: { id: string }; Body: { audioBase64?: string; mimeType?: string; filename?: string } }>(
    "/incidents/:id/stt",
    async (req, reply) => {
      const token = req.headers["x-incident-token"];
      const record = registry.authorize(req.params.id, typeof token === "string" ? token : undefined);
      if (record === undefined) return reply.code(401).send({ error: "unauthorized" });
      if (!grokVoiceEnabled()) return reply.code(503).send({ error: "grok_voice_disabled" });
      const b64 = req.body?.audioBase64;
      if (typeof b64 !== "string") return reply.code(400).send({ error: "missing_audio" });
      try {
        const audio = Uint8Array.from(Buffer.from(b64, "base64"));
        const sttOptions: { mimeType?: string; filename?: string } = {};
        if (req.body?.mimeType !== undefined) sttOptions.mimeType = req.body.mimeType;
        if (req.body?.filename !== undefined) sttOptions.filename = req.body.filename;
        const result = await transcribeAudio(audio, sttOptions);
        return { text: result.text };
      } catch {
        return reply.code(502).send({ error: "stt_failed" });
      }
    },
  );

  fastify.get<{ Params: { id: string } }>("/incidents/:id/replay", async (req, reply) => {
    const token = req.headers["x-incident-token"];
    const record = registry.authorize(req.params.id, typeof token === "string" ? token : undefined);
    if (record === undefined) return reply.code(401).send({ error: "unauthorized" });
    const payload = await registry.replayPayload(record);
    if (payload === null) return reply.code(409).send({ error: "incident_active" });
    return payload;
  });

  await fastify.listen({ port: options.port ?? 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  const flushClient = (ws: WebSocket): void => {
    const entry = sockets.get(ws);
    if (entry === undefined) return;
    if (entry.record.hub.backpressureClosed.has(entry.clientId)) {
      ws.close(1013, "backpressure");
      return;
    }
    for (const m of entry.record.hub.drain(entry.clientId)) ws.send(m);
  };

  /** A throwing message handler must not take the process down; clients get a fixed-text notice. */
  const reportFailure = (record: NonNullable<ReturnType<IncidentRegistry["get"]>>, where: string, error: unknown): void => {
    process.stderr.write(`ember-server: ${where} failed: ${errorText(error)}\n`);
    record.live.failures.push({ kind: "internal_error", atWallMs: record.live.wallElapsedMs });
    try {
      record.hub.notifyTechnicalFailure();
      for (const [ws, entry] of sockets) if (entry.record === record) flushClient(ws);
    } catch (notifyError) {
      process.stderr.write(`ember-server: failure notice failed: ${errorText(notifyError)}\n`);
    }
  };

  fastify.server.on("upgrade", (request: IncomingMessage, socket: unknown, head: Uint8Array) => {
    const rawSocket = socket as { destroy(): void; write(data: string, cb?: () => void): void };
    if (closing) {
      rawSocket.destroy();
      return;
    }
    let route: ReturnType<typeof parseIncidentPath>;
    try {
      route = parseIncidentPath(request.url);
    } catch (err) {
      // decodeURIComponent throws URIError for a path such as /incidents/%/events.
      // Reject the upgrade here, before auth, so the process stays up.
      if (!(err instanceof URIError)) throw err;
      rawSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n", () => {
        rawSocket.destroy();
      });
      return;
    }
    if (route === null) {
      rawSocket.destroy();
      return;
    }
    const token = tokenFromQuery(request.url) ?? request.headers["x-incident-token"]?.toString();
    const record = registry.authorize(route.incidentId, token);
    if (record === undefined) {
      rawSocket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      rawSocket.destroy();
      return;
    }
    if (!record.started) registry.start(record);
    wss.handleUpgrade(request, rawSocket, head, (ws) => {
      const clientId = record.hub.connect();
      sockets.set(ws, { clientId, record });
      ws.on("error", () => {
        // A protocol error or a destroyed socket closes the connection; "close" does the cleanup.
      });
      ws.on("message", (data) => {
        try {
          record.hub.handle(clientId, data.toString(), record.live.wallElapsedMs);
          flushClient(ws);
        } catch (error) {
          reportFailure(record, "message handler", error);
        }
      });
      ws.on("close", () => {
        record.hub.disconnect(clientId, record.live.wallElapsedMs);
        sockets.delete(ws);
      });
      flushClient(ws);
    });
  });

  const timer = setInterval(() => {
    for (const record of registry.all()) {
      if (!record.started) continue;
      record.live.safePump();
      registry.prepareReplay(record);
    }
    for (const ws of [...sockets.keys()]) {
      try {
        flushClient(ws);
      } catch (error) {
        process.stderr.write(`ember-server: flush failed: ${errorText(error)}\n`);
      }
    }
  }, FLUSH_EVERY_MS);

  return {
    port,
    registry,
    close: async () => {
      closing = true;
      clearInterval(timer);
      await stopReplayWorker();
      await closeWebSockets(wss, sockets.keys());
      await fastify.close();
    },
  };
}
