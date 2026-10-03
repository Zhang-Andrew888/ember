/**
 * Value of information for a scout observation point. The score is the documented ranking input
 * (docs/NAVIGATION_AGENTS.md: forecast disagreement about corridor closure times public
 * site-access importance); information bits are reported alongside as a measurement and do not
 * change the ranking. Pure: it reads only the scout's own forecast
 * members, the public road geometry and the scout's own observed closures.
 */

export interface VoiMember {
  /** First ignition time per flat grid cell in ms (Infinity if it never ignites). */
  readonly ignitionMs: ArrayLike<number>;
}

export interface VoiEdge {
  readonly id: string;
  readonly cells: readonly number[];
}

export interface EdgeVoi {
  readonly edgeId: string;
  /** Share of members in which the corridor is closed at the relevant time. */
  readonly closureProbability: number;
  /** Disagreement among members, 4p(1-p) in [0, 1]: the documented ranking input. */
  readonly disagreement: number;
  /** Binary entropy of the same share, in bits: what a perfect look would resolve (measurement only). */
  readonly infoBits: number;
  readonly importance: number;
  /** Already directly observed closed: nothing left to learn. */
  readonly known: boolean;
  readonly voi: number;
}

export interface VoiScore {
  readonly total: number;
  readonly edges: readonly EdgeVoi[];
}

export function binaryEntropyBits(p: number): number {
  if (!(p > 0) || !(p < 1)) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

/** Fraction of members in which any listed cell has ignited by tMs. Empty member set gives 0. */
export function closureProbability(members: readonly VoiMember[], cells: readonly number[], tMs: number): number {
  if (members.length === 0) return 0;
  let closed = 0;
  for (const m of members) {
    if (cells.some((c) => (m.ignitionMs[c] ?? Infinity) <= tMs)) closed += 1;
  }
  return closed / members.length;
}

export interface VoiInput {
  readonly members: readonly VoiMember[];
  /** Corridors the observation point can see. */
  readonly edges: readonly VoiEdge[];
  readonly importance: ReadonlyMap<string, number>;
  /** Cells the scout has directly observed burning or burned. */
  readonly closedCells: ReadonlySet<number>;
  readonly relevantMs: number;
}

/**
 * Value of looking: for each visible corridor, the disagreement among the retained futures times
 * its public importance. Zero when members agree, when the corridor
 * matters to no site, or when the scout already saw it closed. Maximal at an even split.
 */
export function scoreObservationPoint(input: VoiInput): VoiScore {
  const edges: EdgeVoi[] = [];
  let total = 0;
  for (const edge of input.edges) {
    const known = edge.cells.some((c) => input.closedCells.has(c));
    const p = known ? 1 : closureProbability(input.members, edge.cells, input.relevantMs);
    const disagreement = known ? 0 : 4 * p * (1 - p);
    const infoBits = known ? 0 : binaryEntropyBits(p);
    const importance = input.importance.get(edge.id) ?? 0;
    const voi = disagreement * importance;
    edges.push({ edgeId: edge.id, closureProbability: p, disagreement, infoBits, importance, known, voi });
    total += voi;
  }
  return { total, edges };
}
