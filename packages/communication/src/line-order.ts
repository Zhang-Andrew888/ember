import { CompassDirection, type CompassDirection as CompassDirectionT } from "@ember/domain";
import type { Directory, EndRef, LineAnchor, LineCourse } from "./intent.js";

/**
 * The fire-line order language (FIREBREAK_PLAN.md 2.4): an anchor, a course, and optionally which
 * crew takes which end. This module only reads the words; it never checks the map or feasibility.
 */

// ---------- spoken numbers ----------

const DIGITS: Readonly<Record<string, number>> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, niner: 9 };
const TEENS: Readonly<Record<string, number>> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const BEARING_WORD = /^(?:bearing|heading|azimuth)$/;

const isNumberWord = (w: string): boolean => w in DIGITS || w in TEENS || w in TENS || w === "hundred" || w === "thousand";

/** One spoken cardinal starting at `words[i]` ("two hundred and fifty"); `next` is the first word it does not use. */
function cardinal(words: readonly string[], i: number): { value: number; next: number } | null {
  let total = 0;
  let current = 0;
  let j = i;
  let used = false;
  const open = (): boolean => current % 100 === 0 || (current % 100 >= 20 && current % 10 === 0);
  for (; j < words.length; j++) {
    const w = words[j]!;
    if (w === "zero") {
      if (used) break;
      return { value: 0, next: j + 1 };
    }
    if (w in DIGITS && (!used || open()) && !(current % 100 >= 10 && current % 100 < 20)) current += DIGITS[w]!;
    else if (w in TEENS && (!used || current % 100 === 0)) current += TEENS[w]!;
    else if (w in TENS && (!used || current % 100 === 0)) current += TENS[w]!;
    else if (w === "hundred" && (current === 0 ? !used || total > 0 : current < 100)) current = (current === 0 ? 1 : current) * 100;
    else if (w === "thousand" && current < 1000) {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
    } else if (w === "and" && used && (current % 100 === 0 || total > 0) && words[j + 1] !== undefined && (words[j + 1]! in DIGITS || words[j + 1]! in TEENS || words[j + 1]! in TENS)) {
      continue;
    } else break;
    used = true;
  }
  return used ? { value: total + current, next: j } : null;
}

/**
 * Spoken numbers as digits: "two hundred meters" becomes "200 meters", and after "bearing" a run of
 * digit words reads as a bearing, so "bearing zero three zero" becomes "bearing 030".
 */
export function spokenToDigits(text: string): string {
  const parts = text.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?|[^a-z\d]+/g) ?? [];
  const out: string[] = [];
  let lastWord = "";
  for (let i = 0; i < parts.length; ) {
    const part = parts[i]!;
    const isWord = /^[a-z]+$/.test(part);
    const startsNumber = isWord && (isNumberWord(part) || (part === "a" && /^[\s-]+$/.test(parts[i + 1] ?? "") && (parts[i + 2] === "hundred" || parts[i + 2] === "thousand")));
    if (!startsNumber && !(isWord && part === "oh" && BEARING_WORD.test(lastWord))) {
      out.push(part);
      if (isWord) lastWord = part;
      i += 1;
      continue;
    }
    // Number words only; whitespace and hyphens between them are skipped.
    const idx: number[] = [];
    const words: string[] = [];
    for (let k = i; k < parts.length; k++) {
      const p = parts[k]!;
      if (/^[a-z]+$/.test(p)) {
        idx.push(k);
        words.push(p === "a" && k === i ? "one" : p);
      } else if (!/^[\s-]+$/.test(p)) break;
    }
    let value: string | null = null;
    let used = 0;
    if (BEARING_WORD.test(lastWord)) {
      // "zero three zero" -> 030; "three sixty" -> 360.
      let digits = "";
      let n = 0;
      for (; n < words.length && (words[n]! in DIGITS || words[n] === "oh"); n++) digits += words[n] === "oh" ? "0" : String(DIGITS[words[n]!]!);
      const tail = cardinal(words, n);
      if (n === 1 && tail !== null && tail.value < 100 && (words[n]! in TENS || words[n]! in TEENS)) {
        value = String(DIGITS[words[0]!]! * 100 + tail.value);
        used = tail.next;
      } else if (n > 0) {
        value = digits;
        used = n;
      }
    }
    if (value === null) {
      const c = cardinal(words, 0);
      if (c === null) {
        out.push(part);
        lastWord = part;
        i += 1;
        continue;
      }
      value = String(c.value);
      used = c.next;
    }
    out.push(value);
    lastWord = "";
    i = idx[used - 1]! + 1;
  }
  return out.join("");
}

// ---------- the order ----------

const DIR_SOURCE = "north(?:[\\s-]?(?:east|west))?|south(?:[\\s-]?(?:east|west))?|east|west";
const UNIT_SOURCE = "kilometers?|kilometres?|km|meters?|metres?|m";
const DIRECTION = new RegExp(`\\b(?:${DIR_SOURCE})\\b`, "g");
const OFFSET_BEFORE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})\\s+(?:due\\s+)?(${DIR_SOURCE})\\s+of\\s+(?:the\\s+)?$`);
const LENGTH = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})\\b`, "g");
const BEARING = /\b(?:bearing|heading|azimuth)\s+(\d{1,3}(?:\.\d+)?)\b|\b(\d{1,3}(?:\.\d+)?)\s*(?:degrees?|deg|°)/g;
const TO_EDGE = /\bto\s+the\s+(?:map\s+)?(?:edge|border|boundary)\b|\bto\s+the\s+end\s+of\s+the\s+map\b/;
const END_WORD = new RegExp(`(?:the\\s+)?(${DIR_SOURCE}|far|other|opposite|second|start|near|first|anchor)\\s+end\\b|\\bthe\\s+(start)\\b(?!\\s+of)`, "g");
const SCREEN_END = /\b(?:(?:on|at|to|toward|towards|from)\s+the\s+(?:top|bottom|left|right|upper|lower)\b|(?:top|bottom|left|right)[\s-]?(?:hand\s+)?(?:end|edge|side)\b|(?:top|bottom)\s+of\s+the\s+(?:screen|map)\b)/;
/** A crew's own end: "Crew 1 on the south end", "Crew 2 from East Junction". */
const CREW_CONNECTOR = /^[\s,]*(?:(?:on|at|from|takes?|starts?|starting|works?|working|begins?|beginning|with|the)\s+)+$/;
const STRONG_START = /\b(?:start(?:s|ing)?(?:\s+(?:at|from|with|on))?|anchor(?:s|ed|ing)?(?:\s+(?:at|on|from|to))?|begin(?:s|ning)?(?:\s+(?:at|from))?)\s+(?:the\s+)?$/;
const COURSE_BEFORE = /\b(?:to|toward|towards|until|into|tie[sd]?\s+in\s+(?:at|to)|tying\s+in\s+(?:at|to)|connect(?:s|ing)?\s+(?:to|with)|and)\s+(?:the\s+)?$/;
const FROM_BEFORE = /\b(?:from|at|between|off|out\s+of)\s+(?:the\s+)?$/;
/** A place the directory does not know: "from the quarry". The first word must be a name word. */
const UNKNOWN_PLACE = new RegExp(
  `\\b((?:from|to|toward|towards|(?:anchor(?:ed|ing)?|start(?:ing)?|begin(?:ning)?)\\s+(?:at|from))\\s+)(?:(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})\\s+(?:due\\s+)?(${DIR_SOURCE})\\s+of\\s+)?(?:the\\s+)?([a-z][a-z'-]*(?:\\s+[a-z][a-z'-]*){0,3}?)(?=\\s*[,.;:!?]|\\s*$|\\s+(?:to|toward|towards|and|then|for|by|bearing|heading|with|until|north|south|east|west|northeast|northwest|southeast|southwest|crew|crews|starting|working)\\b)`,
  "g",
);
const NOT_A_PLACE = new Set([
  "the", "a", "an", "edge", "map", "each", "other", "start", "end", "far", "both", "near", "first", "second", "opposite", "it", "us", "them", "there", "here",
  "bearing", "heading", "line", "fire", "firebreak", "break", "cut", "build", "dig", "clear", "construct", "make", "work", "run", "go", "move", "head",
  "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "top", "bottom", "left", "right",
]);

const toDirection = (heard: string): CompassDirectionT | null => {
  const parsed = CompassDirection.safeParse(heard.replace(/[\s-]/g, ""));
  return parsed.success ? parsed.data : null;
};
const toMeters = (amount: string, unit: string): number => Number(amount) * (unit.startsWith("k") ? 1000 : 1);
const isNameChar = (c: string | undefined): boolean => c !== undefined && /[a-z0-9]/.test(c);

export interface LineOrder {
  readonly anchor?: LineAnchor;
  readonly course?: LineCourse;
  /** Crews in the order named, with the end each was told to take; absent when no crew has one. */
  readonly crews?: readonly { recipient: string; end: EndRef }[];
  /** The single crew addressed when there are no per-crew ends. */
  readonly recipient?: string;
  /** Set when the words cannot be read as one order; the gateway asks it. */
  readonly clarification?: string;
}

interface Mention {
  at: number;
  end: number;
  name: string;
  offset?: { meters: number; direction: CompassDirectionT };
}

/** Read one fire-line order. `text` is what the coordinator typed or said. */
export function parseLineOrder(text: string, directory: Directory): LineOrder {
  const s = spokenToDigits(text);
  const masked = s.split("");
  const mask = (at: number, end: number): void => {
    for (let k = at; k < end; k++) masked[k] = "#";
  };

  // Crews named, in order; a callsign also matches its spoken form ("crew one" reads as "crew 1").
  const crewMentions: { at: number; end: number; callsign: string }[] = [];
  for (const agent of directory.agents) {
    const callsign = spokenToDigits(agent.callsign);
    for (let at = s.indexOf(callsign); at >= 0; at = s.indexOf(callsign, at + 1)) {
      if (!isNameChar(s[at - 1]) && !isNameChar(s[at + callsign.length])) crewMentions.push({ at, end: at + callsign.length, callsign: agent.callsign });
    }
  }
  crewMentions.sort((a, b) => a.at - b.at);
  for (const c of crewMentions) mask(c.at, c.end);
  const crewOrder: string[] = [];
  for (const c of crewMentions) if (!crewOrder.includes(c.callsign)) crewOrder.push(c.callsign);

  // Known places, longest name first so "Refuge West" is not read as a shorter overlapping name.
  const mentions: Mention[] = [];
  for (const place of [...(directory.places ?? [])].sort((a, b) => b.name.length - a.name.length)) {
    const name = spokenToDigits(place.name);
    for (let at = s.indexOf(name); at >= 0; at = s.indexOf(name, at + 1)) {
      const end = at + name.length;
      if (isNameChar(s[at - 1]) || isNameChar(s[end])) continue;
      if (mentions.some((m) => at < m.end && end > m.at)) continue;
      mentions.push({ at, end, name: place.name });
    }
  }
  mentions.sort((a, b) => a.at - b.at);
  for (const m of mentions) mask(m.at, m.end);
  // "<N> m <direction> of <place>": the offset belongs to the place that follows it.
  for (const m of mentions) {
    const hit = s.slice(0, m.at).match(OFFSET_BEFORE);
    const direction = hit === null ? null : toDirection(hit[3]!);
    if (hit !== null && direction !== null) {
      m.offset = { meters: toMeters(hit[1]!, hit[2]!), direction };
      m.at -= hit[0].length;
      mask(m.at, m.end);
    }
  }
  // Names the directory does not know are passed on so the gateway can say so.
  const maskedNow = (): string => masked.join("");
  for (const hit of maskedNow().matchAll(UNKNOWN_PLACE)) {
    const phrase = hit[5]!;
    if (NOT_A_PLACE.has(phrase.split(/\s+/)[0]!) || /\b(?:line|firebreak|break|crew)\b/.test(phrase)) continue;
    const direction = hit[4] === undefined ? null : toDirection(hit[4]);
    const offset = hit[2] === undefined || hit[3] === undefined || direction === null ? undefined : { meters: toMeters(hit[2], hit[3]), direction };
    // The span starts after the preposition, as for a known place, so the same word-before rules apply.
    mentions.push({ at: hit.index! + hit[1]!.length, end: hit.index! + hit[0].length, name: phrase, ...(offset === undefined ? {} : { offset }) });
  }
  mentions.sort((a, b) => a.at - b.at);
  for (const m of mentions) mask(m.at, m.end);

  // Screen words cannot be understood: the server never sees the camera.
  if (SCREEN_END.test(s)) {
    return { clarification: "I can't see your screen, so top, bottom, left and right don't tell me where. Use a compass direction like north or south, \"start\" or \"far end\", or a place name." };
  }

  // A crew's own end: "Crew 1 on the south end", "Crew 2 from East Junction". Placed after the owner by position.
  const ends = new Map<string, EndRef>();
  const ownerBefore = (at: number): { end: number; callsign: string } | undefined => [...crewMentions].reverse().find((c) => c.end <= at);
  for (const hit of maskedNow().matchAll(END_WORD)) {
    const at = hit.index!;
    const owner = ownerBefore(at);
    const between = s.slice(owner?.end ?? 0, at);
    if (owner === undefined || (between.trim() !== "" && !CREW_CONNECTOR.test(between))) continue;
    const word = (hit[1] ?? hit[2])!;
    const compass = toDirection(word);
    ends.set(owner.callsign, compass !== null ? { compass } : /^(?:start|near|first|anchor)$/.test(word) ? "start" : "far");
    mask(at, at + hit[0].length);
  }
  for (const m of mentions) {
    const owner = ownerBefore(m.at);
    if (owner === undefined || m.offset !== undefined || ends.has(owner.callsign) || !CREW_CONNECTOR.test(s.slice(owner.end, m.at))) continue;
    ends.set(owner.callsign, { placeName: m.name });
  }

  // Anchor and course place, by the word in front of each mention.
  const roleOf = (m: Mention): "strong" | "course" | "from" | "plain" => {
    const before = s.slice(Math.max(0, m.at - 30), m.at);
    return STRONG_START.test(before) ? "strong" : COURSE_BEFORE.test(before) ? "course" : FROM_BEFORE.test(before) ? "from" : "plain";
  };
  if (mentions.some((m) => m.offset !== undefined && roleOf(m) === "course")) {
    return { clarification: "A line can tie in at a named place, but I can't offset that end. Name the place, or give a direction and length instead." };
  }
  const anchorMention =
    mentions.find((m) => m.offset !== undefined) ??
    mentions.find((m) => roleOf(m) === "strong") ??
    mentions.find((m) => roleOf(m) === "from") ??
    mentions.find((m) => roleOf(m) === "plain") ??
    mentions[0];
  const courseMention =
    mentions.find((m) => m.name !== anchorMention?.name && roleOf(m) === "course") ?? mentions.find((m) => m.name !== anchorMention?.name);
  const anchor: LineAnchor | undefined =
    anchorMention === undefined
      ? undefined
      : { placeName: anchorMention.name, ...(anchorMention.offset === undefined ? {} : { offsetMeters: anchorMention.offset.meters, offsetDirection: anchorMention.offset.direction }) };

  // Course: a place to tie in at, else a heading.
  let course: LineCourse | undefined;
  const rest = maskedNow();
  if (courseMention !== undefined) {
    course = { kind: "to_place", placeName: courseMention.name };
  } else {
    const directions = new Set<CompassDirectionT>();
    for (const hit of rest.matchAll(DIRECTION)) {
      const d = toDirection(hit[0]);
      if (d !== null) directions.add(d);
    }
    const bearings = [...rest.matchAll(BEARING)].map((h) => Number(h[1] ?? h[2]));
    const lengths = [...new Set([...rest.matchAll(LENGTH)].map((h) => toMeters(h[1]!, h[2]!)))];
    const toEdge = TO_EDGE.test(rest);
    if (directions.size > 1) return { clarification: "Which single compass direction should the line run?" };
    if (bearings.some((b) => b > 360)) return { clarification: "Bearings run from 0 to 360 degrees. Which bearing should the line run?" };
    if (lengths.length > 1) return { clarification: "How long should the line be? Give one length in meters." };
    const direction = [...directions][0];
    const bearingDeg = bearings[0];
    const lengthMeters = lengths[0];
    if (direction !== undefined || bearingDeg !== undefined || toEdge || lengthMeters !== undefined) {
      course = {
        kind: "heading",
        ...(direction === undefined ? {} : { direction }),
        ...(bearingDeg === undefined ? {} : { bearingDeg }),
        ...(toEdge ? { toEdge: true } : lengthMeters === undefined ? {} : { lengthMeters }),
      };
    }
  }

  // Crews: named ends as given; with none given, one crew takes the start and two take start and far end.
  const explicit = crewOrder.filter((c) => ends.has(c));
  let crews: { recipient: string; end: EndRef }[] | undefined;
  if (crewOrder.length > 0 && explicit.length > 0) {
    if (explicit.length < crewOrder.length) {
      const unassigned = crewOrder.filter((c) => !ends.has(c));
      return { clarification: `Which end should ${unassigned.join(" and ")} take?` };
    }
    crews = crewOrder.map((recipient) => ({ recipient, end: ends.get(recipient)! }));
  } else if (crewOrder.length > 1) {
    crews = crewOrder.map((recipient, i) => ({ recipient, end: i === 0 ? "start" : "far" }));
  }
  return {
    ...(anchor === undefined ? {} : { anchor }),
    ...(course === undefined ? {} : { course }),
    ...(crews === undefined ? {} : { crews }),
    ...(crews === undefined && crewOrder.length === 1 ? { recipient: crewOrder[0]! } : {}),
  };
}
