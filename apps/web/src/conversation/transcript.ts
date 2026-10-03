import type { CoordinatorReportEntry, CoordinatorView } from "@ember/domain";
import type { ServerWireMessage, WireAudioCue, WireReceipt, WireTranscript } from "../net/serverWireParse.js";
import { routineReports } from "../format/reports.js";

export type TranscriptLineKind =
  | "agent_report"
  | "coordinator"
  | "control"
  | "system"
  | "command_outcome"
  | "clarification"
  | "rejection";

export interface TranscriptLine {
  readonly id: string;
  readonly kind: TranscriptLineKind;
  readonly simTimeMs: number;
  readonly speaker: string;
  readonly text: string;
  readonly urgent: boolean;
}

export interface WireSidebandState {
  readonly transcripts: readonly WireTranscript[];
  readonly receipts: readonly WireReceipt[];
  readonly audioCues: readonly WireAudioCue[];
}

export const EMPTY_SIDEBAND: WireSidebandState = { transcripts: [], receipts: [], audioCues: [] };

export function appendSideband(current: WireSidebandState, message: ServerWireMessage): WireSidebandState {
  switch (message.type) {
    case "view":
      return current;
    case "transcript":
      return { ...current, transcripts: [...current.transcripts, message] };
    case "receipt":
      return { ...current, receipts: [...current.receipts, message] };
    case "audio":
      return { ...current, audioCues: [...current.audioCues, message] };
    default:
      return current;
  }
}

function outcomeKind(receipt: WireReceipt["receipt"]): TranscriptLineKind {
  if (receipt.status === "clarification_required") return "clarification";
  if (receipt.status === "rejected") return "rejection";
  return "command_outcome";
}

function transcriptKind(kind: WireTranscript["kind"]): TranscriptLineKind {
  if (kind === "coordinator") return "coordinator";
  if (kind === "control") return "control";
  return "system";
}

function reportLine(report: CoordinatorReportEntry, callsignFor: (agentId: string) => string): TranscriptLine {
  return {
    id: `report:${report.sequence as number}`,
    kind: "agent_report",
    simTimeMs: report.simTimeMs as number,
    speaker: callsignFor(report.agentId as string),
    text: report.text,
    urgent: report.urgent,
  };
}

function wireTranscriptLine(message: WireTranscript): TranscriptLine {
  return {
    id: `wire-t:${message.simTimeMs}:${message.text.slice(0, 24)}`,
    kind: transcriptKind(message.kind),
    simTimeMs: message.simTimeMs,
    speaker: message.kind === "coordinator" ? "Coordinator" : message.kind,
    text: message.text,
    urgent: message.urgent,
  };
}

function receiptLine(receipt: WireReceipt, index: number, fallbackSimTimeMs: number): TranscriptLine {
  return {
    id: `receipt:${receipt.receipt.commandId as string}:${index}`,
    kind: outcomeKind(receipt.receipt),
    simTimeMs: (receipt.receipt.appliedTick as number | null) ?? fallbackSimTimeMs,
    speaker: "Coordinator",
    text: receipt.reply || receipt.receipt.explanation,
    urgent: false,
  };
}

/** Merges agent reports from the coordinator view with coordinator/control wire transcripts and command outcomes. */
export function buildConversationTranscript(
  view: CoordinatorView | null,
  sideband: WireSidebandState,
): TranscriptLine[] {
  const callsignFor = (agentId: string): string =>
    view?.agents.find((agent) => agent.id === agentId)?.callsign ?? agentId;

  const lines: TranscriptLine[] = [];
  if (view) {
    for (const report of routineReports(view)) {
      lines.push(reportLine(report, callsignFor));
    }
  }
  for (const message of sideband.transcripts) {
    lines.push(wireTranscriptLine(message));
  }
  const fallbackSimTimeMs = view ? (view.simTimeMs as number) : 0;
  sideband.receipts.forEach((receipt, index) => {
    lines.push(receiptLine(receipt, index, fallbackSimTimeMs));
  });

  return lines.sort((a, b) => a.simTimeMs - b.simTimeMs || a.id.localeCompare(b.id));
}
