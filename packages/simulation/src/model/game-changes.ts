import { SIM_DEFAULTS } from "./constants.js";

/**
 * Gameplay overrides for the game-changes experiment branch.
 * These are coordinator-facing behavior knobs, not wildfire physics claims.
 */
export const GAME_CHANGES = {
  /**
   * Max hose reach (tiles × cell width). Tied to the web HoseMist cone (~125 m /
   * 5 tiles at default cell size), not a full-length firehose.
   */
  hoseSuppressRadiusTiles: 5,
  /** Hose only affects burning cells within this half-angle of the crew's travel heading (degrees). */
  hoseConeHalfAngleDeg: 90,
  /** Must finish the committed approach before any hose work applies (no remote sniping). */
  requireApproachBeforeHose: true,
  /** How close the crew must be to active fire before hose work applies (tiles). */
  hoseOnSceneRadiusTiles: 5,
  /** Inside this radius of burning cells, crews back off instead of driving closer (tiles). */
  hoseDangerRadiusTiles: 3,
  /** Preferred minimum standoff from fire while hosing after backing out (tiles). */
  hoseStandoffTargetTiles: 4,
  /** Multiplier on suppression work-units per second while hosing. */
  hoseWorkRateMultiplier: 2.85,
  /** Fraction of default work-units needed to fully knock down a burning cell. */
  hoseWorkRequiredFactor: 0.65,
  /** Keep the incident running after fire is out only while a site is still threatened by fire or damage. */
  deferWinOnFireOut: true,
  /** Only assign structure protection when fire has reached a site's exposure zone (or the site is already damaged). */
  protectSitesOnlyWhenThreatened: true,
  /** Fully extinguish (burned state) when containment work completes, not only stop spread. */
  extinguishOnContainmentComplete: true,
  /** Idle crews seek fire suppression instead of returning to refuge first. */
  prioritizeFireOverRefuge: true,
  /** Containment missions omit the return leg; refuge is not the default end state. */
  skipReturnLegAfterSuppress: true,
  /** Added to work rate for each additional crew hosing the same cell from a different side. */
  collaborationBonusPerCrew: 0.35,
  /** Off-road legs use the standard half-speed factor when approaching fire. */
  offRoadSpeedFactor: 0.5,
  /** Directional orders may use off-road when no safe road route with return margin exists. */
  allowOffroadDirectional: true,
  /** When false, crews suppress only cells they have observed (or been relayed); briefing is coordinator-only. */
  useBriefingFireCells: false,
  /** Along the same approach, each brigade slot stops this many meters farther from the fire. */
  brigadeLineSpacingM: 45,
  /** Containment missions outrank structure protection when any burn cell is targeted. */
  suppressMissionValue: 100,
  /** Mission value for structure work when fire is in a site's exposure zone. */
  siteThreatMissionValue: 150,
  /** Fire-first nav ignores forecast spread; only directly observed fire blocks routes. */
  ignoreForecastSpreadForFire: true,
  /** When no fire is known, send idle crews on directional patrol instead of holding at refuge. */
  patrolWhenNoFireKnown: true,
  /** Max travel distance for autonomous patrol legs (meters). */
  patrolMaxDistanceM: 700,
  /** Split brigade standoff only when the crew sees two or more burning cells. */
  brigadeSplitMinBurnCells: 2,
  /** A crew that can see another crew hosing within this many tiles joins its line. */
  brigadeJoinRadiusTiles: 40,
  /** Joining crews work burning cells within this many tiles of the line's anchor cell. */
  lineCellRadiusTiles: 5,
  /** Hoses count as the same side when their directions differ by at most ~60°. */
  lineSameSideMinDot: 0.5,
  /** Work-rate bonus per extra crew spraying the same cell from the same side (a line). */
  lineCollaborationBonusPerCrew: 0.6,
  /** Crews in a line stand about this many tiles apart along the front so their sprays tile it. */
  lineSlotSpacingTiles: 4,
  /** Join a line only when getting there takes at most this much longer than the crew's best alternative. */
  lineMaxDetourMs: 45_000,
} as const;

export function scenarioUsesGameChanges(scenario: { gameChanges?: boolean | undefined }): boolean {
  return scenario.gameChanges === true;
}

/** Hose spray reach in meters (must match apps/web HoseMist extent). */
export function gameHoseRadiusM(): number {
  return GAME_CHANGES.hoseSuppressRadiusTiles * SIM_DEFAULTS.cellMeters;
}

/** Minimum dot(cellDir, hoseHeading) for suppression; 90° half-angle ⇒ dot ≥ 0 (forward hemisphere). */
export function gameHoseConeMinDot(): number {
  const rad = (GAME_CHANGES.hoseConeHalfAngleDeg * Math.PI) / 180;
  return Math.cos(rad);
}

/** Crew must be this close to burning cells to start knocking them down (on scene, not at refuge). */
export function gameHoseOnSceneRadiusM(): number {
  return GAME_CHANGES.hoseOnSceneRadiusTiles * SIM_DEFAULTS.cellMeters;
}

/** Crews within this distance of burning cells must back off (still within hose reach). */
export function gameHoseDangerRadiusM(): number {
  return GAME_CHANGES.hoseDangerRadiusTiles * SIM_DEFAULTS.cellMeters;
}

/** Target distance from fire after a danger-zone backoff (meters). */
export function gameHoseStandoffTargetM(): number {
  return GAME_CHANGES.hoseStandoffTargetTiles * SIM_DEFAULTS.cellMeters;
}

/** How far away a crew can see another crew working fire and join its line (meters). */
export function gameBrigadeJoinRadiusM(): number {
  return GAME_CHANGES.brigadeJoinRadiusTiles * SIM_DEFAULTS.cellMeters;
}

/** Cells within this distance of a line's anchor cell belong to the same fire front (meters). */
export function gameLineCellRadiusM(): number {
  return GAME_CHANGES.lineCellRadiusTiles * SIM_DEFAULTS.cellMeters;
}

/** Spacing between neighbouring crews in a hose line (meters). */
export function gameLineSlotSpacingM(): number {
  return GAME_CHANGES.lineSlotSpacingTiles * SIM_DEFAULTS.cellMeters;
}

/** Work-rate bonus another crew adds on a shared cell: more when both hoses face the same way (a line). */
export function gameCollaborationBonus(
  self: { hx: number; hy: number } | null,
  other: { hx: number; hy: number } | null,
): number {
  const sameSide = self !== null && other !== null && self.hx * other.hx + self.hy * other.hy >= GAME_CHANGES.lineSameSideMinDot;
  return sameSide ? GAME_CHANGES.lineCollaborationBonusPerCrew : GAME_CHANGES.collaborationBonusPerCrew;
}

/** Work-units to fully suppress one burning cell under game-changes hose rules. */
export function gameContainmentWorkRequired(): number {
  return Math.max(1, SIM_DEFAULTS.containmentWorkRequired * GAME_CHANGES.hoseWorkRequiredFactor);
}

/** Desired hose standoff from fire for a crew slot (farther back when peers already hold closer). */
export function brigadeTargetDistanceFromFireM(agentId: string, peerCountOnCell: number): number {
  const max = gameHoseRadiusM();
  const spacing = GAME_CHANGES.brigadeLineSpacingM;
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (Math.imul(31, h) + agentId.charCodeAt(i)) >>> 0;
  const slot = (h % 4) + peerCountOnCell;
  return Math.max(max * 0.55, max - slot * spacing);
}
