import type { AgentId, CompassDirection } from "@ember/domain";
import type { RankedMission } from "@ember/navigation";
import { cellCenter } from "@ember/simulation/model";

const PATROL_DIRECTIONS: readonly CompassDirection[] = ["north", "east", "south", "west"];
const ALL_DIRECTIONS: readonly CompassDirection[] = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
];

/** Stable crew slot for spreading assignments along a fire line (0 … crewCount − 1). */
export function agentBrigadeSlot(agentId: AgentId, crewCount: number): number {
  if (crewCount <= 1) return 0;
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (Math.imul(31, h) + agentId.charCodeAt(i)) >>> 0;
  return h % crewCount;
}

/** Sort burn cells along a brigade line (south→north, then west→east). */
export function fireLineOrder(cells: readonly number[]): readonly number[] {
  return [...cells].sort((a, b) => {
    const ca = cellCenter(a);
    const cb = cellCenter(b);
    return ca.y - cb.y || ca.x - cb.x;
  });
}

/**
 * When structures are threatened, reserve at least one crew for site work: if another crew
 * is already on the fire line, this crew should protect; otherwise alternate by callsign slot.
 */
export function preferSiteWhenThreatened(
  agentId: AgentId,
  peerSuppressCells: ReadonlySet<number>,
  threatenedSiteCount: number,
  knownBurnCellCount: number,
  minSplitCells: number,
): boolean {
  if (threatenedSiteCount === 0) return false;
  if (knownBurnCellCount < minSplitCells) return false;
  if (peerSuppressCells.size > 0) return true;
  return agentBrigadeSlot(agentId, 2) === 1;
}

/** Prefer containment candidates on open segments of the fire line, not cells peers already hold. */
export function patrolDirectionForAgent(agentId: AgentId): CompassDirection {
  return PATROL_DIRECTIONS[agentBrigadeSlot(agentId, PATROL_DIRECTIONS.length)] ?? "north";
}

/**
 * All eight headings, starting from this crew's own patrol heading and rotating with each
 * completed patrol so a crew does not keep re-driving the same leg.
 */
export function patrolDirectionsForAgent(agentId: AgentId, round: number): CompassDirection[] {
  const first = ALL_DIRECTIONS.indexOf(patrolDirectionForAgent(agentId));
  const start = (first + round * 3) % ALL_DIRECTIONS.length;
  return ALL_DIRECTIONS.map((_, i) => ALL_DIRECTIONS[(start + i) % ALL_DIRECTIONS.length]!);
}

export function shouldSplitBrigadeLine(knownBurnCellCount: number, minCells: number): boolean {
  return knownBurnCellCount >= minCells;
}

/** Two crews on one cell: the lowest agent id keeps it and every other holder moves to open fire. */
export function shouldYieldCell(agentId: AgentId, otherHolders: readonly string[]): boolean {
  return otherHolders.some((other) => other < agentId);
}

export function rankContainmentCandidates(
  agentId: AgentId,
  candidates: readonly RankedMission[],
  burningCells: readonly number[],
  peerSuppressCells: ReadonlySet<number>,
): RankedMission[] {
  if (burningCells.length < 2) {
    return [...candidates].sort((a, b) => b.score - a.score);
  }
  const line = fireLineOrder(burningCells);
  const slot = agentBrigadeSlot(agentId, Math.max(line.length, 2));
  const lineIndex = new Map(line.map((c, i) => [c, i]));
  return [...candidates].sort((a, b) => {
    const ca = a.target.gridCellIndex;
    const cb = b.target.gridCellIndex;
    const peerA = ca !== undefined && peerSuppressCells.has(ca) ? 1 : 0;
    const peerB = cb !== undefined && peerSuppressCells.has(cb) ? 1 : 0;
    if (peerA !== peerB) return peerA - peerB;
    const distA = ca !== undefined ? Math.abs((lineIndex.get(ca) ?? 0) - slot) : 99;
    const distB = cb !== undefined ? Math.abs((lineIndex.get(cb) ?? 0) - slot) : 99;
    if (distA !== distB) return distA - distB;
    return b.score - a.score;
  });
}
