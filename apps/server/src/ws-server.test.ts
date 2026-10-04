import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { buildSyntheticScenario } from "@ember/simulation";
import { parseServerWire } from "./protocol.js";
import { startServer } from "./ws-server.js";

vi.setConfig({ testTimeout: 30_000 });

function connect(port: number): Promise<{ socket: WebSocket; received: unknown[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const received: unknown[] = [];
    socket.on("message", (d) => received.push(JSON.parse(d.toString())));
    socket.on("open", () => resolve({ socket, received }));
    socket.on("error", reject);
  });
}

function envelopeType(frame: unknown): string | undefined {
  const obj = frame as { message?: { type: string }; type?: string };
  return obj.message?.type ?? obj.type;
}

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("websocket server", () => {
  it("sends a coordinator view on connect, validates input, acknowledges commands and never leaks the seed", async () => {
    const server = await startServer({ scenario: buildSyntheticScenario(), seed: "WS-SECRET-SEED-5521", uncontrolled: ["crew-1", "crew-2", "crew-3"] });
    const { socket, received } = await connect(server.port);
    await until(() => received.length > 0);
    const first = parseServerWire(JSON.stringify(received[0]));
    expect(first?.type).toBe("view");

    socket.send("garbage");
    socket.send(JSON.stringify({ type: "say", text: "Crew 2, hold position", idempotencyKey: "ws-1" }));
    await until(
      () =>
        received.some((m) => envelopeType(m) === "receipt") &&
        received.some((m) => {
          const t = envelopeType(m);
          return t === "notice" && (m as { message?: { kind?: string } }).message?.kind === "bad_message";
        }),
    );
    const receiptFrame = received.find((m) => envelopeType(m) === "receipt") as {
      message: { receipt: { status: string; recipientId: string } };
    };
    expect(receiptFrame.message.receipt).toMatchObject({ status: "accepted", recipientId: "crew-2" });
    expect(JSON.stringify(received)).not.toContain("WS-SECRET-SEED-5521");

    socket.close();
    await server.close();
  });

  it("closes a connection that sends an oversized message and keeps serving others", async () => {
    const server = await startServer({ scenario: buildSyntheticScenario(), seed: "WS-LIMIT", uncontrolled: ["crew-1", "crew-2", "crew-3"] });
    const big = await connect(server.port);
    const closed = new Promise<void>((resolve) => big.socket.on("close", () => resolve()));
    big.socket.send("x".repeat(256 * 1024));
    await closed;
    const other = await connect(server.port);
    await until(() => other.received.length > 0);
    other.socket.close();
    await server.close();
  });
});
