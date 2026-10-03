import type { CoordinatorAgentView } from "@ember/domain";
import type { SiteProtectionStatus } from "../../../format/reports.js";

/**
 * Pure rules for what the crew and site models show. Every state has a
 * SHAPE cue (a glyph or a silhouette change) and a TEXT cue, so nothing
 * depends on colour alone (docs/FRONTEND.md accessibility).
 */

export type AgentState = CoordinatorAgentView["state"];
export type AgentGlyph = "none" | "forward" | "back" | "work" | "warn" | "cross";

export interface AgentCue {
  readonly glyph: AgentGlyph;
  /** Model is knocked over (lost). */
  readonly lying: boolean;
  /** Model is desaturated (lost). */
  readonly muted: boolean;
  readonly text: string;
}

const CUES: Record<AgentState, AgentCue> = {
  idle: { glyph: "none", lying: false, muted: false, text: "idle" },
  approaching: { glyph: "forward", lying: false, muted: false, text: "approaching" },
  working: { glyph: "work", lying: false, muted: false, text: "working" },
  withdrawing: { glyph: "back", lying: false, muted: false, text: "withdrawing" },
  retreating: { glyph: "warn", lying: false, muted: false, text: "retreating" },
  lost: { glyph: "cross", lying: true, muted: true, text: "lost" },
};

export function agentCue(state: AgentState): AgentCue {
  return CUES[state];
}

/** "Crew 1 · working": the label always spells the state out. */
export function agentLabelText(callsign: string, state: AgentState): string {
  return `${callsign} · ${CUES[state].text}`;
}

/** Crew number from the callsign ("Crew 2" -> 2); falls back to 1-based order among crews. */
export function crewNumber(callsign: string, crewOrdinal: number): number {
  const match = /(\d+)\s*$/.exec(callsign);
  const parsed = match ? Number(match[1]) : NaN;
  const n = Number.isFinite(parsed) && parsed > 0 ? parsed : crewOrdinal + 1;
  return Math.min(5, Math.max(1, n));
}

export type SiteModelKind = "cabins" | "waterworks" | "lodge";
const KINDS: readonly SiteModelKind[] = ["cabins", "waterworks", "lodge"];

/** Picks a silhouette from the site name; unknown names rotate through the three by order. */
export function siteModelKind(name: string, index: number): SiteModelKind {
  const lower = name.toLowerCase();
  if (/cabin|cottage|hut/.test(lower)) return "cabins";
  if (/water|tank|reservoir|pump/.test(lower)) return "waterworks";
  if (/lodge|hall|center|centre|school|church/.test(lower)) return "lodge";
  return KINDS[((index % 3) + 3) % 3]!;
}

export interface SiteCue {
  /** Drawn as an outlined ghost: nothing is known about it. */
  readonly ghost: boolean;
  /** Fence-post ring: protection work is underway. */
  readonly fenceRing: boolean;
  /** Collapsed rubble with an X. */
  readonly collapsed: boolean;
}

const SITE_CUES: Record<SiteProtectionStatus, SiteCue> = {
  unobserved: { ghost: true, fenceRing: false, collapsed: false },
  unprotected: { ghost: false, fenceRing: false, collapsed: false },
  partially_protected: { ghost: false, fenceRing: true, collapsed: false },
  destroyed: { ghost: false, fenceRing: false, collapsed: true },
};

export function siteCue(status: SiteProtectionStatus): SiteCue {
  return SITE_CUES[status];
}

export const DAMAGE_NOTCHES = 4;

/** Filled notches (0..4) of the damage gauge; null = nothing observed, no gauge. Damage is separate from protection. */
export function damageNotches(damage: number | null): number | null {
  if (damage === null) return null;
  const clamped = Math.min(1, Math.max(0, damage));
  return clamped === 0 ? 0 : Math.max(1, Math.ceil(clamped * DAMAGE_NOTCHES));
}
