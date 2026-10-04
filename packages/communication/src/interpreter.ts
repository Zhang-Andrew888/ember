import type { Directory, IntentEnvelope } from "./intent.js";
import { IntentEnvelope as IntentSchema } from "./intent.js";

export interface InterpretationRequest {
  readonly commandId: string;
  readonly inputSequence: number;
  readonly text: string;
  /** Public names, the active recipient and recent coordinator utterances only. */
  readonly directory: Directory;
  readonly activeRecipientCallsign: string | null;
}

/** Anything that turns coordinator text into a proposed envelope. A real provider fits here. */
export interface Interpreter {
  interpret(request: InterpretationRequest): IntentEnvelope | null;
  /** Stop one in-flight provider call. Scripted interpreters have nothing to cancel. */
  cancel?(inputSequence: number): void;
  /** Stop every in-flight provider call. */
  cancelAll?(): void;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CLAIM = /\b(?:is|are)\s+(?:definitely\s+|totally\s+|completely\s+)?(?:safe|clear|open|closed|burning|fine)\b/i;

/**
 * Deterministic, provider-free interpreter for tests and local development. It parses callsigns,
 * public site names, a handful of intent verbs and report references. It never invents
 * observations: factual claims are only recorded as unsupported.
 */
export class ScriptedInterpreter implements Interpreter {
  interpret(req: InterpretationRequest): IntentEnvelope | null {
    const text = req.text;
    const lower = text.toLowerCase();
    const callsigns = new Set<string>();
    for (const a of req.directory.agents) if (lower.includes(a.callsign.toLowerCase())) callsigns.add(a.callsign);
    // "Scout's latest report" names a source, not a recipient, when the text asks to use/relay it.
    const usesReport = /\b(use|relay|pass|forward|tell)\b[^.]*\b(report|observation|sighting)\b/.test(lower) || /\blatest\b[^.]*\breport\b/.test(lower);
    const sources: string[] = [];
    if (usesReport) {
      for (const a of req.directory.agents) {
        if (new RegExp(`${escapeRegExp(a.callsign.toLowerCase())}'?s?\\s+(latest\\s+)?[a-z\\- ]*(report|observation|sighting)`).test(lower)) {
          sources.push(a.callsign);
          callsigns.delete(a.callsign);
        }
      }
    }
    const names = [...callsigns];
    const envelope: IntentEnvelope = {
      commandId: req.commandId,
      inputSequence: req.inputSequence,
      kind: "objective",
      evidenceQueries: [],
      unsupportedClaims: [],
    };
    if (names.length > 1) envelope.clarification = `Which one: ${names.join(" or ")}?`;
    else if (names.length === 1) envelope.explicitRecipient = names[0]!;

    const claim = lower.match(CLAIM);
    if (claim !== null) envelope.unsupportedClaims.push(text.trim());

    if (usesReport) {
      envelope.kind = "relay";
      const location = req.directory.locations.find((l) => lower.includes(l.name.toLowerCase()));
      envelope.evidenceQueries.push({
        ...(sources[0] === undefined ? {} : { sourceName: sources[0] }),
        ...(location === undefined ? {} : { locationName: location.name }),
        timeSelector: /\blatest\b/.test(lower) ? "latest" : "referenced",
      });
    }

    const site = req.directory.sites.find((s) => tokensOverlap(lower, s.name));
    if (/\b(status|where are you|what are you doing|how long|when will|explain|your plan|what'?s your plan|why are you)\b/.test(lower) && !/\bprotect\b/.test(lower)) {
      envelope.kind = "status";
    } else if (/\b(contain|suppress|hold the line)\b/.test(lower)) {
      const location = req.directory.locations.find((l) => lower.includes(l.name.toLowerCase()));
      envelope.objective = { kind: "contain", ...(location === undefined ? {} : { targetName: location.name }) };
    } else if (/\b(protect|save|defend|work on|go to)\b/.test(lower)) {
      envelope.objective = { kind: "protect", ...(site === undefined ? targetGuess(lower) : { targetName: site.name }) };
    } else if (/\b(scout|observe|check|look at)\b/.test(lower) && !usesReport) {
      const point = req.directory.scoutPoints.find((p) => lower.includes(p.name.toLowerCase()));
      envelope.objective = { kind: "observe", ...(point === undefined ? {} : { targetName: point.name }) };
    } else if (/\b(avoid)\b/.test(lower)) {
      const location = req.directory.locations.find((l) => lower.includes(l.name.toLowerCase()));
      envelope.objective = { kind: "avoid", ...(location === undefined ? {} : { targetName: location.name }) };
    } else if (/\b(return|come back|fall back|withdraw)\b/.test(lower)) {
      envelope.objective = { kind: "return" };
    } else if (/\b(hold|stay|stand by)\b/.test(lower)) {
      envelope.objective = { kind: "hold" };
    } else if (/\b(resume|carry on|continue|your own judgment|autonomous)\b/.test(lower)) {
      envelope.objective = { kind: "resume" };
    }
    if (envelope.kind === "objective" && envelope.objective === undefined && names.length <= 1) {
      envelope.kind = names.length === 1 && lower.trim().split(/\s+/).length <= 3 ? "clarification_answer" : "objective";
    }
    return IntentSchema.parse(envelope);
  }
}

function tokensOverlap(lower: string, name: string): boolean {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => !["the", "community"].includes(t))
    .some((t) => t.length > 3 && lower.includes(t));
}

function targetGuess(lower: string): { targetName?: string } {
  const m = lower.match(/\b(?:protect|save|defend|work on|go to)\s+(?:the\s+)?([a-z ]+)$/);
  return m?.[1] === undefined ? {} : { targetName: m[1].trim() };
}

/** Failure-injection adapters. */
export class FailingInterpreter implements Interpreter {
  interpret(): IntentEnvelope | null {
    return null;
  }
}
