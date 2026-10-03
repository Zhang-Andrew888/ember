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

/** Display name for a wire transcript author: the player's own words are "You", never "Coordinator". */
const WIRE_SPEAKER: Record<WireTranscript["kind"], string> = {
  coordinator: "You",
  control: "Control",
  agent: "Crew",
  system: "System",
};

/** Append-only sideband index. Padded so localeCompare preserves arrival order. */
function wireTranscriptId(sequence: number): string {
  return `wire-t:${sequence.toString().padStart(6, "0")}`;
}

function wireTranscriptLine(message: WireTranscript, view: CoordinatorView | null, sequence: number): TranscriptLine {
  const callsign =
    message.kind === "agent" ? view?.agents.find((agent) => message.text.startsWith(agent.callsign))?.callsign : undefined;
  return {
    id: wireTranscriptId(sequence),
    kind: message.kind === "agent" ? "agent_report" : transcriptKind(message.kind),
    simTimeMs: message.simTimeMs,
    speaker: callsign ?? WIRE_SPEAKER[message.kind],
    text: message.text,
    urgent: message.urgent,
  };
}

function receiptLine(receipt: WireReceipt, index: number, fallbackSimTimeMs: number): TranscriptLine {
  return {
    id: `receipt:${receipt.receipt.commandId as string}:${index}`,
    kind: outcomeKind(receipt.receipt),
    simTimeMs: (receipt.receipt.appliedTick as number | null) ?? fallbackSimTimeMs,
    speaker: "Control",
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
  const fallbackSimTimeMs = view ? (view.simTimeMs as number) : 0;
  const receiptLines = sideband.receipts.map((receipt, index) => receiptLine(receipt, index, fallbackSimTimeMs));
  const receiptTexts = new Set(receiptLines.map((line) => line.text));
  for (const [sequence, message] of sideband.transcripts.entries()) {
    // Routine agent lines repeat the agent's report (the view already carries it), and a control
    // line repeats the matching receipt reply; keep the one that carries the richer state.
    // The sequence is the append-only sideband index, so keys stay unique and stable when the
    // view is replaced and when two lines share a sim time or text prefix.
    if (message.kind === "agent" && !message.urgent) continue;
    if (message.kind === "control" && receiptTexts.has(message.text)) continue;
    lines.push(wireTranscriptLine(message, view, sequence));
  }
  lines.push(...receiptLines);

  // At the same sim time the player's own message reads before the reply to it.
  const rank = (line: TranscriptLine): number => (line.speaker === "You" ? 0 : 1);
  return lines.sort((a, b) => a.simTimeMs - b.simTimeMs || rank(a) - rank(b) || a.id.localeCompare(b.id));
}
