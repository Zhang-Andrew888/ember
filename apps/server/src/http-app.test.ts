import { describe, expect, it } from "vitest";
import { connect } from "node:net";
import { WebSocket } from "ws";
import { startHttpApp } from "./http-app.js";
import { parseServerWire } from "./protocol.js";
import { encodeClient } from "./protocol.js";

/** Raw upgrade so the path can contain a broken percent-escape the ws client would reject locally. */
function requestUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });
    let body = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`upgrade ${path} did not close`));
    }, 2_000);
    socket.on("data", (chunk) => {
      body += chunk.toString();
    });
    socket.on("error", () => {
      // A rejected upgrade may reset the socket; close still follows.
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(body);
    });
  });
}

/** Finish the upgrade and leave the TCP socket open, without answering a WebSocket close frame. */
function holdUpgrade(port: number, path: string): Promise<ReturnType<typeof connect>> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });
    let header = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`upgrade ${path} did not complete`));
    }, 2_000);
    socket.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(`upgrade ${path} failed`));
    });
    socket.on("data", (chunk) => {
      if (settled) return;
      header += chunk.toString();
      if (!header.includes("\r\n\r\n")) return;
      settled = true;
      clearTimeout(timer);
      if (!header.startsWith("HTTP/1.1 101")) {
        socket.destroy();
        const status = header.split("\r\n")[0] ?? header;
        reject(new Error(`upgrade ${path} rejected: ${status}`));
        return;
      }
      resolve(socket);
    });
  });
}

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

  it("rejects a malformed percent-encoded upgrade and still serves the next request", async () => {
    const app = await startHttpApp({});
    try {
      const rejected = await requestUpgrade(app.port, "/incidents/%/events");
      expect(rejected.startsWith("HTTP/1.1 400")).toBe(true);

      const health = await fetch(`http://127.0.0.1:${app.port}/health`);
      expect(health.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("finishes shutdown while a WebSocket client stays connected", async () => {
    const app = await startHttpApp({});
    const create = await fetch(`http://127.0.0.1:${app.port}/incidents`, { method: "POST" });
    const body = (await create.json()) as { websocket: { events: string } };
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${app.port}${body.websocket.events}`);
      socket.on("open", () => resolve(socket));
      socket.on("error", reject);
    });
    await new Promise<void>((resolve) => {
      ws.on("message", () => resolve());
    });
    const clientClosed = new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
    });

    const started = performance.now();
    await app.close();

    expect(performance.now() - started).toBeLessThan(5_000);
    await clientClosed;
    await expect(fetch(`http://127.0.0.1:${app.port}/health`)).rejects.toThrow();
  });

  it("finishes shutdown when the peer never completes the close handshake", async () => {
    const app = await startHttpApp({});
    const create = await fetch(`http://127.0.0.1:${app.port}/incidents`, { method: "POST" });
    const body = (await create.json()) as { websocket: { events: string } };
    const peer = await holdUpgrade(app.port, body.websocket.events);
    try {
      const started = performance.now();
      await app.close();
      expect(performance.now() - started).toBeLessThan(5_000);
      await expect(fetch(`http://127.0.0.1:${app.port}/health`)).rejects.toThrow();
    } finally {
      peer.destroy();
    }
  });
});
