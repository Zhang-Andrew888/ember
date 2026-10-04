import { describe, expect, it } from "vitest";
import type { CommandReceipt } from "@ember/domain";
import type { SidebandNotice, SidebandReceipt } from "../conversation/transcript.js";
import { deliveryGuidance, deliveryLabel, deriveDelivery, isAwaitingOutcome, type SentCommand } from "./commandDelivery.js";

const sent: SentCommand = {
  commandId: "client-1",
  commandText: "Crew 1, move north and stop at the nearest safe road.",
  source: "map",
  agentId: "crew-1",
  callsign: "Crew 1",
  submitted: true,
  noticeIndexAtSend: 0,
};

function receipt(commandId: string, status: CommandReceipt["status"], explanation = ""): SidebandReceipt {
  return {
    type: "receipt",
    receipt: {
      commandId: commandId as never,
      status,
      recipientId: null,
      appliedTick: null,
      explanation,
      planRevision: null,
    },
    reply: "",
    arrivalSimTimeMs: 0,
  };
}

function notice(kind: SidebandNotice["kind"], detail = ""): SidebandNotice {
  return { type: "notice", kind, detail, arrivalSimTimeMs: 0 } as SidebandNotice;
}

describe("deriveDelivery", () => {
  it("is not_submitted when nothing left the page", () => {
    expect(deriveDelivery({ ...sent, submitted: false }, [], []).phase).toBe("not_submitted");
  });

  it("stays sent while no receipt carries this command's id", () => {
    const delivery = deriveDelivery(sent, [receipt("cmd-7", "accepted")], []);
    expect(delivery.phase).toBe("sent");
    expect(isAwaitingOutcome(delivery.phase)).toBe(true);
  });

  it("moves sent → received → accepted from receipts with the exact id", () => {
    expect(deriveDelivery(sent, [receipt("client-1", "received")], []).phase).toBe("received");
    const accepted = deriveDelivery(sent, [receipt("client-1", "received"), receipt("client-1", "accepted", "Queued")], []);
    expect(accepted.phase).toBe("accepted");
    expect(accepted.explanation).toBe("Queued");
  });

  it("reports refused and clarification phases from terminal receipts", () => {
    expect(deriveDelivery(sent, [receipt("client-1", "rejected", "No road")], []).phase).toBe("rejected");
    expect(deriveDelivery(sent, [receipt("client-1", "clarification_required")], []).phase).toBe("clarification_required");
  });

  it("shows interpreting only for a still_interpreting notice naming this command", () => {
    expect(deriveDelivery(sent, [], [notice("still_interpreting", "client-1")]).phase).toBe("interpreting");
    expect(deriveDelivery(sent, [], [notice("still_interpreting", "cmd-3")]).phase).toBe("sent");
  });

  it("marks the outcome unknown after a later technical failure, never refused", () => {
    const delivery = deriveDelivery(sent, [], [notice("technical_failure")]);
    expect(delivery.phase).toBe("outcome_unknown");
    expect(deliveryLabel(delivery.phase)).not.toMatch(/refused/i);
  });

  it("ignores failures that happened before the command was sent", () => {
    const delivery = deriveDelivery({ ...sent, noticeIndexAtSend: 1 }, [], [notice("backpressure")]);
    expect(delivery.phase).toBe("sent");
  });

  it("lets a terminal receipt win over an earlier failure notice", () => {
    expect(deriveDelivery(sent, [receipt("client-1", "accepted")], [notice("technical_failure")]).phase).toBe("accepted");
  });

  it("offers guidance for phases that need a next step", () => {
    expect(deliveryGuidance("not_submitted")).toMatch(/kept/);
    expect(deliveryGuidance("outcome_unknown")).toMatch(/before resending/);
    expect(deliveryGuidance("accepted")).toBeNull();
  });
});
