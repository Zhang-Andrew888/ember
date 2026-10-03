import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startHttpApp } from "./http-app.js";
import { parseServerWire } from "./protocol.js";
import { encodeClient } from "./protocol.js";

describe("http-app transport", () => {
  it("creates an incident, starts it, and streams versioned coordinator views", async () => {
    const app = await startHttpApp({});
    const create = await fetch(`http://127.0.0.1:${app.port}/incidents`, { method: "POST" });
    const body = (await create.json()) as {
      incidentId: string;
      token: string;
      protocolVersion: number;
      websocket: { events: string };
    };
    expect(body.protocolVersion).toBe(1);

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${app.port}${body.websocket.events}`);
      socket.on("open", () => resolve(socket));
      socket.on("error", reject);
    });

    const first = await new Promise<unknown>((resolve) => {
      ws.on("message", (d) => resolve(JSON.parse(d.toString())));
    });
    const viewMsg = parseServerWire(JSON.stringify(first));
    expect(viewMsg?.type).toBe("view");

    ws.send(
      encodeClient({
        type: "say",
        text: "Crew 2, hold position",
        idempotencyKey: "http-test-1",
      }),
    );

    await new Promise((r) => setTimeout(r, 400));
    ws.close();
    await app.close();
  });
});
