import type { AgentId } from "@ember/domain";

export interface CallsignEntry {
  readonly agentId: AgentId;
  readonly callsign: string;
}

/** Every lookup ends in exactly one of these: a named-recipient command always resolves. */
export type CallsignResolution =
  | { readonly kind: "match"; readonly agentId: AgentId; readonly callsign: string }
  | { readonly kind: "ambiguous"; readonly candidates: readonly CallsignEntry[] }
  | { readonly kind: "unknown"; readonly heard: string };

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};

/** Spoken filler that is never part of a callsign. */
const FILLER: ReadonlySet<string> = new Set(["the", "to", "please", "hey", "hello"]);

/** Lowercase tokens with punctuation dropped and number words turned into digits: "Crew-Two" is ["crew", "2"]. */
export function callsignTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t !== "")
    .map((t) => NUMBER_WORDS[t] ?? t);
}

/**
 * Callsigns for the authored agent ids: "crew-N" becomes "Crew N", "scout" becomes "Scout"
 * (docs/SIMULATION.md), anything else is title-cased from its id.
 */
export function defaultCallsign(agentId: string): string {
  const crew = /^crew[-_ ]?(\d+)$/i.exec(agentId);
  if (crew !== null) return `Crew ${crew[1]}`;
  return callsignTokens(agentId)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");
}

/**
 * Resolves a spoken or typed name to one agent, deterministically and without throwing:
 * an exact normalized match wins; otherwise every callsign containing all heard tokens is a
 * candidate. One candidate matches, several are ambiguous (sorted by callsign), none is unknown.
 * Callsigns that normalize identically are always ambiguous, never silently picked.
 */
export class CallsignDirectory {
  private readonly entries: readonly (CallsignEntry & { readonly tokens: readonly string[] })[];

  constructor(entries: readonly CallsignEntry[]) {
    this.entries = [...entries]
      .sort((a, b) => (a.callsign < b.callsign ? -1 : a.callsign > b.callsign ? 1 : a.agentId < b.agentId ? -1 : 1))
      .map((e) => ({ ...e, tokens: callsignTokens(e.callsign) }));
  }

  get callsigns(): string[] {
    return this.entries.map((e) => e.callsign);
  }

  resolve(heard: string): CallsignResolution {
    const q = callsignTokens(heard).filter((t) => !FILLER.has(t));
    if (q.length === 0) return { kind: "unknown", heard };
    const key = q.join(" ");
    const exact = this.entries.filter((e) => e.tokens.join(" ") === key);
    const pool = exact.length > 0 ? exact : this.entries.filter((e) => q.every((t) => e.tokens.includes(t)));
    const [first] = pool;
    if (first === undefined) return { kind: "unknown", heard };
    if (pool.length === 1) return { kind: "match", agentId: first.agentId, callsign: first.callsign };
    return { kind: "ambiguous", candidates: pool.map(({ agentId, callsign }) => ({ agentId, callsign })) };
  }

  /** A short question the coordinator can be asked when a name is ambiguous or unknown; null when it matched. */
  clarification(resolution: CallsignResolution): string | null {
    if (resolution.kind === "match") return null;
    if (resolution.kind === "ambiguous") return `Which do you mean: ${resolution.candidates.map((c) => c.callsign).join(" or ")}?`;
    return `I don't have a crew or scout called "${resolution.heard}". Known callsigns: ${this.callsigns.join(", ")}.`;
  }
}
