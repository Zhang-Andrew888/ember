import type { CommandReceipt } from "@ember/domain";
import { encodeServerWireMessage } from "./serverWireParse.js";

function receipt(
  status: CommandReceipt["status"],
  reply: string,
  explanation: string,
  commandId: string,
): string {
  return encodeServerWireMessage({
    type: "receipt",
    receipt: {
      commandId: commandId as CommandReceipt["commandId"],
      status,
      recipientId: null,
      appliedTick: null,
      explanation,
      planRevision: null,
    },
    reply,
  });
}

function coordinatorTranscript(text: string, simTimeMs: number): string {
  return encodeServerWireMessage({
    type: "transcript",
    kind: "coordinator",
    text,
    simTimeMs,
    urgent: false,
  });
}

/** Deterministic mock replies when no live gateway is attached (mock/demo mode). */
export function mockWireRepliesForSay(text: string, simTimeMs: number, commandId: string): readonly string[] {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (/^\s*status\b/.test(lower) || lower.includes("status report")) {
    return [
      coordinatorTranscript(
        "Crew 1 approaching Ridge Cabins; Crew 2 idle at Refuge West.",
        simTimeMs,
      ),
      receipt("accepted", "Status relayed.", "Status query answered from current coordinator view.", commandId),
    ];
  }

  if (!/crew\s*[12]?/i.test(trimmed)) {
    return [
      receipt(
        "clarification_required",
        "Which crew should receive this?",
        "Named recipient required.",
        commandId,
      ),
    ];
  }

  if (/cannot|refuse|invalid objective/i.test(trimmed)) {
    return [
      receipt(
        "rejected",
        "That objective cannot be applied.",
        "Planner rejected the objective.",
        commandId,
      ),
    ];
  }

  if (/\bmove (north|northeast|east|southeast|south|southwest|west|northwest)\b/i.test(lower)) {
    return [
      receipt("received", `Received: ${trimmed}`, "Directional movement order logged.", commandId),
      receipt(
        "accepted",
        `${trimmed.split(",")[0]?.trim() ?? "Crew"} acknowledged the movement order.`,
        "Objective queued for planning.",
        commandId,
      ),
    ];
  }

  return [receipt("received", `Received: ${trimmed}`, "", commandId)];
}
