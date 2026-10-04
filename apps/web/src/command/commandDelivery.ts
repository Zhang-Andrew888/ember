import type { CommandReceipt } from "@ember/domain";
import type { SidebandNotice, SidebandReceipt } from "../conversation/transcript.js";

export type CommandSource = "map" | "text" | "voice";

export type CommandDeliveryPhase =
  | "not_submitted"
  | "sent"
  | "interpreting"
  | "received"
  | "replied"
  | "accepted"
  | "rejected"
  | "clarification_required"
  | "incident_ended"
  | "stale"
  | "outcome_unknown";

/** One message the coordinator tried to send, as recorded by this page at send time. */
export interface SentCommand {
  /** Idempotency key this page generated; receipts are matched to it only on an exact match. */
  readonly commandId: string;
  readonly commandText: string;
  readonly source: CommandSource;
  /** Addressed crew when the page built the order (map orders); null for free text. */
  readonly agentId: string | null;
  readonly callsign: string | null;
  /** False when the socket was not open, so nothing left this page. */
  readonly submitted: boolean;
  /** `notices.length` when sent: only later notices can describe this command. */
  readonly noticeIndexAtSend: number;
  /** `receipts.length` when sent: a later receipt under another id is a reply that may or may not be to this command. */
  readonly receiptIndexAtSend: number;
}

export interface CommandDelivery extends SentCommand {
  readonly phase: CommandDeliveryPhase;
  readonly explanation: string | null;
}

const TERMINAL: ReadonlySet<CommandReceipt["status"]> = new Set([
  "accepted",
  "rejected",
  "clarification_required",
  "incident_ended",
  "stale",
]);

/**
 * Delivery state from what the server actually said. A terminal receipt always wins; without one,
 * a later server failure makes the outcome unknown (never "refused"), and nothing is shown as
 * accepted until a receipt with this command's own id says so.
 */
export function deriveDelivery(
  command: SentCommand,
  receipts: readonly SidebandReceipt[],
  notices: readonly SidebandNotice[],
): CommandDelivery {
  if (!command.submitted) return { ...command, phase: "not_submitted", explanation: null };
  const own = receipts.filter((receipt) => (receipt.receipt.commandId as string) === command.commandId);
  const terminal = [...own].reverse().find((receipt) => TERMINAL.has(receipt.receipt.status));
  if (terminal !== undefined) {
    return {
      ...command,
      phase: terminal.receipt.status as CommandDeliveryPhase,
      explanation: terminal.receipt.explanation || null,
    };
  }
  const later = notices.slice(command.noticeIndexAtSend);
  if (later.some((notice) => notice.kind === "technical_failure" || notice.kind === "backpressure")) {
    return { ...command, phase: "outcome_unknown", explanation: null };
  }
  if (later.some((notice) => notice.kind === "still_interpreting" && notice.detail === command.commandId)) {
    return { ...command, phase: "interpreting", explanation: null };
  }
  const received = own[own.length - 1];
  if (received !== undefined) {
    return { ...command, phase: "received", explanation: received.receipt.explanation || null };
  }
  // The live server tags receipts with its own command ids, so a later reply cannot be tied to
  // this command; say that Control replied without claiming what the reply decided.
  if (receipts.length > command.receiptIndexAtSend) {
    return { ...command, phase: "replied", explanation: null };
  }
  return { ...command, phase: "sent", explanation: null };
}

export function deliveryLabel(phase: CommandDeliveryPhase): string {
  switch (phase) {
    case "not_submitted":
      return "Not sent: the connection was not open";
    case "sent":
      return "Sent, waiting for Control";
    case "interpreting":
      return "Control is still interpreting";
    case "received":
      return "Received by Control";
    case "replied":
      return "Control has replied since this was sent";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Refused";
    case "clarification_required":
      return "Clarification needed";
    case "incident_ended":
      return "Not applied: incident ended";
    case "stale":
      return "Not applied: out of date";
    case "outcome_unknown":
      return "Outcome unknown: a server problem occurred";
  }
}

/** Follow-up guidance for phases where the label alone does not say what to do next. */
export function deliveryGuidance(phase: CommandDeliveryPhase): string | null {
  switch (phase) {
    case "not_submitted":
      return "Your text was kept. Send it again once the connection is back.";
    case "sent":
    case "received":
      return "Control's reply appears in the conversation.";
    case "interpreting":
      return "Wait for the reply before resending.";
    case "replied":
      return "Read the reply in the conversation; it may answer this or an earlier message.";
    case "outcome_unknown":
      return "Check the conversation for a reply before resending.";
    default:
      return null;
  }
}

export function isAwaitingOutcome(phase: CommandDeliveryPhase): boolean {
  return phase === "sent" || phase === "interpreting" || phase === "received" || phase === "replied";
}
