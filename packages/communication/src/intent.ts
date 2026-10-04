import { z } from "zod";
import { CompassDirection } from "@ember/domain";

/**
 * What the language interpreter may propose. The server, not the model, creates authoritative
 * ids, resolves entities and evidence, and authorizes recipients.
 */
export const IntentEnvelope = z.object({
  commandId: z.string().min(1),
  inputSequence: z.number().int().nonnegative(),
  explicitRecipient: z.string().optional(),
  kind: z.enum(["objective", "relay", "status", "clarification_answer"]),
  objective: z
    .object({
      kind: z.enum(["protect", "contain", "observe", "return", "hold", "avoid", "resume", "move"]),
      targetName: z.string().optional(),
      direction: CompassDirection.optional(),
      maxDistanceMeters: z.number().positive().max(1200).optional(),
    })
    .optional(),
  evidenceQueries: z.array(
    z.object({
      sourceName: z.string().optional(),
      locationName: z.string().optional(),
      timeSelector: z.enum(["latest", "referenced"]).optional(),
      referencedReportId: z.string().optional(),
    }),
  ),
  unsupportedClaims: z.array(z.string()),
  clarification: z.string().optional(),
});
export type IntentEnvelope = z.infer<typeof IntentEnvelope>;

/** Public names the interpreter may refer to. Contains nothing hidden. */
export interface Directory {
  readonly agents: readonly { id: string; callsign: string; role: "protection_crew" | "scout" }[];
  readonly sites: readonly { id: string; name: string }[];
  /** Named places used to match report footprints, e.g. "east corridor". */
  readonly locations: readonly { name: string; x: number; y: number; radius: number }[];
  /** Named road segments for avoid-corridor objectives; id is the edge id. */
  readonly corridors: readonly { id: string; name: string }[];
}

export type NameMatch = { kind: "unique"; id: string } | { kind: "ambiguous"; ids: string[] } | { kind: "unknown" };

const STOP = new Set(["the", "a", "an", "at", "to", "of", "for", "report", "reports", "road", "latest"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP.has(t));
}

/** Match a spoken name against public names: exact first, then every spoken token present. */
export function matchName(query: string, candidates: readonly { id: string; name: string }[]): NameMatch {
  const q = tokens(query);
  if (q.length === 0) return { kind: "unknown" };
  const normalized = query.toLowerCase().trim();
  const exact = candidates.filter((c) => c.name.toLowerCase() === normalized);
  if (exact.length === 1) return { kind: "unique", id: exact[0]!.id };
  const hits = candidates.filter((c) => {
    const t = new Set(tokens(c.name));
    return q.every((tok) => t.has(tok));
  });
  if (hits.length === 1) return { kind: "unique", id: hits[0]!.id };
  if (hits.length > 1) return { kind: "ambiguous", ids: hits.map((h) => h.id) };
  return { kind: "unknown" };
}
