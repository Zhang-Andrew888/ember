import { describe, expect, it } from "vitest";
import { applyReceipts, deliveryLabel, registerSentCommand } from "./mapCommandDelivery.js";

describe("mapCommandDelivery", () => {
  it("tracks sent → accepted from wire receipts", () => {
    let rows = registerSentCommand([], {
      commandId: "cmd-a",
      commandText: "Crew 1, move north and stop at the nearest safe road.",
      agentId: "crew-1",
      callsign: "Crew 1",
    });
    expect(rows[0]?.phase).toBe("sent");
    rows = applyReceipts(rows, [
      {
        type: "receipt",
        receipt: {
          commandId: "cmd-a" as never,
          status: "received",
          recipientId: null,
          appliedTick: null,
          explanation: "",
          planRevision: null,
        },
        reply: "Received",
      },
    ]);
    expect(rows[0]?.phase).toBe("received");
    rows = applyReceipts(rows, [
      {
        type: "receipt",
        receipt: {
          commandId: "cmd-a" as never,
          status: "accepted",
          recipientId: "crew-1" as never,
          appliedTick: 1 as never,
          explanation: "Queued",
          planRevision: null,
        },
        reply: "Acknowledged",
      },
    ]);
    expect(rows[0]?.phase).toBe("accepted");
    expect(deliveryLabel(rows[0]!.phase)).toBe("Accepted");
  });
});
