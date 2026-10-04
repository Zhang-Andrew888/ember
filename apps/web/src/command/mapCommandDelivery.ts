import type { CommandReceipt } from "@ember/domain";
import type { WireReceipt } from "../net/serverWireParse.js";

export type MapCommandDeliveryPhase =
  | "draft"
  | "sent"
  | "received"
  | "accepted"
  | "rejected"
  | "clarification_required"
  | "incident_ended"
  | "stale";

export interface MapCommandDelivery {
  readonly commandId: string;
  readonly commandText: string;
  readonly agentId: string;
  readonly callsign: string;
  readonly phase: MapCommandDeliveryPhase;
  readonly explanation: string | null;
}

function phaseFromReceipt(status: CommandReceipt["status"]): MapCommandDeliveryPhase {
  if (status === "received") return "received";
  if (status === "accepted") return "accepted";
  if (status === "rejected") return "rejected";
  if (status === "clarification_required") return "clarification_required";
  if (status === "incident_ended") return "incident_ended";
  if (status === "stale") return "stale";
  return "received";
}

export function registerSentCommand(
  current: readonly MapCommandDelivery[],
  entry: { readonly commandId: string; readonly commandText: string; readonly agentId: string; readonly callsign: string },
): readonly MapCommandDelivery[] {
  return [
    ...current.filter((c) => c.commandId !== entry.commandId),
    {
      ...entry,
      phase: "sent",
      explanation: null,
    },
  ];
}

export function applyReceipts(
  current: readonly MapCommandDelivery[],
  receipts: readonly WireReceipt[],
): readonly MapCommandDelivery[] {
  if (current.length === 0 || receipts.length === 0) return current;
  let changed = false;
  const next = current.map((row) => {
    const match = [...receipts].reverse().find((r) => (r.receipt.commandId as string) === row.commandId);
    if (match === undefined) return row;
    const phase = phaseFromReceipt(match.receipt.status);
    if (phase === row.phase && match.receipt.explanation === row.explanation) return row;
    changed = true;
    return {
      ...row,
      phase,
      explanation: match.receipt.explanation ?? null,
    };
  });
  return changed ? next : current;
}

export function deliveryLabel(phase: MapCommandDeliveryPhase): string {
  switch (phase) {
    case "draft":
      return "Ready to send";
    case "sent":
      return "Sent — awaiting response";
    case "received":
      return "Received by control";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Refused";
    case "clarification_required":
      return "Clarification needed";
    case "incident_ended":
      return "Incident ended";
    case "stale":
      return "Stale";
  }
}
