import Fastify from "fastify";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { WIRE_PROTOCOL_VERSION } from "@ember/domain";
import { IncidentRegistry } from "./incident-registry.js";
import { grokIntentEnabled, grokVoiceEnabled } from "./xai/env.js";
import { transcribeAudio } from "./xai/stt.js";
import type { MonotonicClock } from "./runner.js";
import type { ClientId } from "./hub.js";

const FLUSH_EVERY_MS = 200;
const MAX_MESSAGE_BYTES = 64 * 1024;

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

/**
 * Fastify HTTP routes plus WebSocket upgrade for `/incidents/:id/events` and `/incidents/:id/voice`.
 * Voice uses the same validated JSON push-to-talk messages as events (provider audio is future work).
 */
export async function startHttpApp(options: { port?: number; clock?: MonotonicClock } = {}): Promise<HttpAppHandle> {
  const clock: MonotonicClock = options.clock ?? { nowMs: () => performance.now() };
  const registry = new IncidentRegistry();
  const fastify = Fastify({ logger: false });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const sockets = new Map<WebSocket, { clientId: ClientId; record: NonNullable<ReturnType<IncidentRegistry["get"]>> }>();

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
    const payload = registry.replayPayload(record);
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

  fastify.server.on("upgrade", (request: IncomingMessage, socket: unknown, head: Uint8Array) => {
    const rawSocket = socket as { destroy(): void; write(data: string): void };
    const route = parseIncidentPath(request.url);
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
      ws.on("message", (data) => {
        record.hub.handle(clientId, data.toString(), record.live.wallElapsedMs);
        flushClient(ws);
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
      record.live.pump();
    }
    for (const ws of [...sockets.keys()]) flushClient(ws);
  }, FLUSH_EVERY_MS);

  return {
    port,
    registry,
    close: async () => {
      clearInterval(timer);
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await fastify.close();
    },
  };
}
