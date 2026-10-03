import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startHttpApp } from "./http-app.js";
import { TECHNICAL_FAILURE_DETAIL } from "./hub.js";
import { IncidentRegistry } from "./incident-registry.js";
import { encodeClient, parseServerWire } from "./protocol.js";
import type { ServerMessage } from "./protocol.js";

const clock = { nowMs: () => 0 };

function drainMessages(registry: IncidentRegistry, id: string, clientId: number): ServerMessage[] {
  const record = registry.get(id)!;
  return record.hub.drain(clientId).map((raw) => parseServerWire(raw)!);
}

describe("incident seed (#48, #42)", () => {
  it("is not derivable from the public incident id or the create response", async () => {
    const app = await startHttpApp({});
    try {
      const res = await fetch(`http://127.0.0.1:${app.port}/incidents`, { method: "POST" });
      const parsed = (await res.json()) as { incidentId: string };
      const text = JSON.stringify(parsed);
      const body = parsed;
      const seed = app.registry.get(body.incidentId)!.seed;
      expect(seed).not.toBe(`incident-${body.incidentId}`);
      expect(seed).not.toContain(body.incidentId);
      expect(text).not.toContain(seed);
      expect(seed).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      await app.close();
    }
  });

  it("differs between incidents by default", () => {
    const registry = new IncidentRegistry();
    expect(registry.create({}, clock).seed).not.toBe(registry.create({}, clock).seed);
  });

  it("uses the operator seed (DEMO_SEED) for every incident when configured, and never echoes it", async () => {
    const app = await startHttpApp({ seed: "showcase-1" });
    try {
      const res = await fetch(`http://127.0.0.1:${app.port}/incidents`, { method: "POST" });
      const parsed = (await res.json()) as { incidentId: string };
      const text = JSON.stringify(parsed);
      const body = parsed;
      expect(app.registry.get(body.incidentId)!.seed).toBe("showcase-1");
      expect(text).not.toContain("showcase-1");
    } finally {
      await app.close();
    }
  });

  it("ignores a seed supplied in the request body", async () => {
    const app = await startHttpApp({});
    try {
      const res = await fetch(`http://127.0.0.1:${app.port}/incidents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed: "attacker-chosen" }),
      });
      const body = (await res.json()) as { incidentId: string };
      expect(app.registry.get(body.incidentId)!.seed).not.toBe("attacker-chosen");
    } finally {
      await app.close();
    }
  });
});

describe("failure containment (#51)", () => {
  it("safePump swallows a pump exception, halts the incident and notifies clients once with fixed text", () => {
    const registry = new IncidentRegistry();
    const record = registry.create({}, clock);
    registry.start(record);
    const clientId = record.hub.connect();
    drainMessages(registry, record.id, clientId);
    record.live.pump = () => {
      throw new Error("secret internal detail seed=abc");
    };

    expect(() => record.live.safePump()).not.toThrow();
    expect(record.live.isHalted).toBe(true);
    expect(record.live.failures.at(-1)?.kind).toBe("internal_error");

    const messages = drainMessages(registry, record.id, clientId);
    expect(messages).toEqual([{ type: "notice", kind: "technical_failure", detail: TECHNICAL_FAILURE_DETAIL }]);

    expect(() => record.live.safePump()).not.toThrow();
    expect(drainMessages(registry, record.id, clientId)).toEqual([]);
  });

  it("a throwing message handler does not kill the server and clients get a technical_failure notice", async () => {
    const app = await startHttpApp({});
    try {
      const create = await fetch(`http://127.0.0.1:${app.port}/incidents`, { method: "POST" });
      const body = (await create.json()) as { incidentId: string; websocket: { events: string } };
      const record = app.registry.get(body.incidentId)!;
      record.hub.handle = () => {
        throw new Error("boom");
      };

      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${app.port}${body.websocket.events}`);
        socket.on("open", () => resolve(socket));
        socket.on("error", reject);
      });
      const notice = new Promise<ServerMessage>((resolve) => {
        ws.on("message", (d) => {
          const m = parseServerWire(d.toString());
          if (m?.type === "notice") resolve(m);
        });
      });
      ws.send(encodeClient({ type: "say", text: "Crew 2, hold position", idempotencyKey: "k1" }));
      expect(await notice).toEqual({ type: "notice", kind: "technical_failure", detail: TECHNICAL_FAILURE_DETAIL });

      const health = await fetch(`http://127.0.0.1:${app.port}/health`);
      expect(health.ok).toBe(true);
      ws.close();
    } finally {
      await app.close();
    }
  });
});
