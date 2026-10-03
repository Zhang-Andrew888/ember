import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { buildSyntheticScenario } from "@ember/simulation";
import { ServerMessage } from "./protocol.js";
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

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("websocket server", () => {
  it("sends a coordinator view on connect, validates input, acknowledges commands and never leaks the seed", async () => {
    const server = await startServer({ scenario: buildSyntheticScenario(), seed: "WS-SECRET-SEED-5521", uncontrolled: ["crew-1", "crew-2", "crew-3", "scout"] });
    const { socket, received } = await connect(server.port);
    await until(() => received.length > 0);
    expect(() => ServerMessage.parse(received[0])).not.toThrow();
    expect((received[0] as { type: string }).type).toBe("view");

    socket.send("garbage");
    socket.send(JSON.stringify({ type: "say", text: "Crew 2, hold position", idempotencyKey: "ws-1" }));
    await until(() => received.some((m) => (m as { type: string }).type === "receipt") && received.some((m) => (m as { type: string; kind?: string }).kind === "bad_message"));
    const receipt = received.find((m) => (m as { type: string }).type === "receipt") as { receipt: { status: string; recipientId: string } };
    expect(receipt.receipt).toMatchObject({ status: "accepted", recipientId: "crew-2" });
    expect(JSON.stringify(received)).not.toContain("WS-SECRET-SEED-5521");

    socket.close();
    await server.close();
  });
});
