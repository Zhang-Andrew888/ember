import type { Directory, IntentEnvelope } from "./intent.js";
import { IntentEnvelope as IntentSchema } from "./intent.js";
import { CompassDirection, type CompassDirection as CompassDirectionT } from "@ember/domain";

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
const DIRECTION = /\b(?:north(?:[\s-]?east|[\s-]?west)?|south(?:[\s-]?east|[\s-]?west)?|east|west)\b/gi;

function directionsIn(text: string): CompassDirectionT[] {
  const directions = new Set<CompassDirectionT>();
  for (const match of text.matchAll(DIRECTION)) {
    const parsed = CompassDirection.safeParse(match[0]);
    if (parsed.success) directions.add(parsed.data);
  }
  return [...directions];
}

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
    // New incidents have no scout; addressing one still names a recipient so the gateway can say so.
    const addressesScout = !req.directory.agents.some((a) => /\bscout\b/i.test(a.callsign)) && /^\s*(?:(?:hey|ok|okay)[,\s]+)?scouts?\b/i.test(text);
    // "Crew 1's latest report" names a source, not a recipient, when the text asks to use/relay it.
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
    const line = LINE_ORDER.test(lower) ? parseLineOrder(text, req.directory) : null;
    if (line !== null) return IntentSchema.parse(lineEnvelope(req, names, line));
    const envelope: IntentEnvelope = {
      commandId: req.commandId,
      inputSequence: req.inputSequence,
      kind: "objective",
      evidenceQueries: [],
      unsupportedClaims: [],
    };
    if (names.length > 1) envelope.clarification = `Which one: ${names.join(" or ")}?`;
    else if (names.length === 1) envelope.explicitRecipient = names[0]!;
    else if (addressesScout) envelope.explicitRecipient = "Scout";

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
    const movement = /\b(move|head|travel|proceed|go)\b/.test(lower);
    const directions = movement || /^\s*(?:north|south|east|west)/i.test(text) ? directionsIn(text) : [];
    if (/\b(status|where are you|what are you doing|how long|when will|explain|your plan|what'?s your plan|why are you)\b/.test(lower) && !/\bprotect\b/.test(lower)) {
      envelope.kind = "status";
    } else if (/\b(contain|suppress|hold the line)\b/.test(lower)) {
      const location = req.directory.locations.find((l) => lower.includes(l.name.toLowerCase()));
      envelope.objective = { kind: "contain", ...(location === undefined ? {} : { targetName: location.name }) };
    } else if (/\b(protect|save|defend|work on|go to)\b/.test(lower)) {
      envelope.objective = { kind: "protect", ...(site === undefined ? targetGuess(lower) : { targetName: site.name }) };
    } else if (movement || (directions.length > 0 && lower.trim().split(/\s+/).length <= 2)) {
      if (directions.length > 1) envelope.clarification = "Which single compass direction should the crew move?";
      const distance = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)\b/);
      const maxDistanceMeters = distance === null ? undefined : Number(distance[1]);
      if (maxDistanceMeters !== undefined && (maxDistanceMeters <= 0 || maxDistanceMeters > 1200)) {
        envelope.clarification = "How far should the crew move? Choose more than 0 and at most 1,200 meters.";
      }
      envelope.objective = {
        kind: "move",
        ...(directions.length === 1 ? { direction: directions[0]! } : {}),
        ...(maxDistanceMeters === undefined || maxDistanceMeters <= 0 || maxDistanceMeters > 1200 ? {} : { maxDistanceMeters }),
      };
      if (!movement && names.length === 0) envelope.kind = "clarification_answer";
    } else if (/\b(scout|observe|check|look at)\b/.test(lower) && !usesReport) {
      envelope.objective = { kind: "observe" };
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

const LINE_ORDER = /\b(?:cut|build|dig|clear|construct|make|work)\b[^.]*\b(?:fire\s?line|line|fire\s?break|break)\b|\bfire\s?(?:line|break)\b/;
/** "from X", "at X", "starting at X", "on the X end": a crew's own starting end... */
const START_BEFORE = /\b(?:from|at|on)\s+(?:the\s+)?$/;
/** ...unless X opens the line's endpoint pair ("from X to Y", "between X and Y"). */
const PAIR_AFTER = /^\s+(?:to|and|toward|towards)\b/;

interface LineOrder {
  /** Places in the order they are mentioned (the first two are the ends). */
  readonly places: readonly string[];
  /** Callsign -> place it was told to start from. */
  readonly starts: ReadonlyMap<string, string>;
  /** Callsigns in the order they are mentioned. */
  readonly crews: readonly string[];
}

/** Places and per-crew starting ends in a fire-line order, by position in the text. */
function parseLineOrder(text: string, directory: InterpretationRequest["directory"]): LineOrder {
  const lower = text.toLowerCase();
  const mentions: { at: number; end: number; name: string }[] = [];
  // Longest names first so "Refuge West" is not also read as a shorter overlapping name.
  for (const place of [...(directory.places ?? [])].sort((a, b) => b.name.length - a.name.length)) {
    const name = place.name.toLowerCase();
    for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + 1)) {
      if (mentions.some((m) => at < m.end && at + name.length > m.at)) continue;
      mentions.push({ at, end: at + name.length, name: place.name });
    }
  }
  mentions.sort((a, b) => a.at - b.at);
  const crews: { at: number; end: number; callsign: string }[] = [];
  for (const agent of directory.agents) {
    const callsign = agent.callsign.toLowerCase();
    for (let at = lower.indexOf(callsign); at >= 0; at = lower.indexOf(callsign, at + 1)) {
      crews.push({ at, end: at + callsign.length, callsign: agent.callsign });
    }
  }
  crews.sort((a, b) => a.at - b.at);
  // A start phrase belongs to the nearest crew named before it.
  const starts = new Map<string, string>();
  for (const m of mentions) {
    if (!START_BEFORE.test(lower.slice(Math.max(0, m.at - 20), m.at)) || PAIR_AFTER.test(lower.slice(m.end))) continue;
    const owner = [...crews].reverse().find((crew) => crew.end <= m.at);
    if (owner !== undefined && !starts.has(owner.callsign)) starts.set(owner.callsign, m.name);
  }
  const places: string[] = [];
  for (const m of mentions) if (!places.includes(m.name)) places.push(m.name);
  const order: string[] = [];
  for (const c of crews) if (!order.includes(c.callsign)) order.push(c.callsign);
  return { places, starts, crews: order };
}

function lineEnvelope(req: InterpretationRequest, names: readonly string[], line: LineOrder): IntentEnvelope {
  const envelope: IntentEnvelope = {
    commandId: req.commandId,
    inputSequence: req.inputSequence,
    kind: "objective",
    evidenceQueries: [],
    unsupportedClaims: [],
  };
  const [a, b] = line.places;
  if (a === undefined || b === undefined) {
    envelope.clarification = "Between which two places should the fire line run?";
    envelope.objective = { kind: "line", ...(a === undefined ? {} : { fromName: a }) };
    if (names.length === 1) envelope.explicitRecipient = names[0]!;
    return envelope;
  }
  if (line.crews.length <= 1) {
    const crew = line.crews[0];
    if (crew !== undefined) envelope.explicitRecipient = crew;
    const start = crew === undefined ? undefined : line.starts.get(crew);
    const from = start ?? a;
    envelope.objective = { kind: "line", fromName: from, toName: from === a ? b : a };
    return envelope;
  }
  // Several crews: explicit starts first, then the ends nobody claimed, in mention order.
  const ends = [a, b];
  const unclaimed = ends.filter((end) => ![...line.starts.values()].includes(end));
  const assignments = line.crews.map((crew) => ({ recipient: crew, startName: line.starts.get(crew) ?? unclaimed.shift() ?? a }));
  envelope.objective = { kind: "line", fromName: a, toName: b, assignments };
  return envelope;
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
