import { z } from "zod";
import { AgentId, EdgeId, MissionPlanId, NodeId, SiteId } from "./ids.js";
import { SequenceNumber, SimTimeMs, WallTimeMs, WorkUnits } from "./units.js";
import { AgentPosition, MapPoint } from "./position.js";
import { AgentRole, AgentState, ContainmentWorkResult, IncidentEnd, MissionWork, OffroadTimedLeg } from "./records.js";
import { WIRE_PROTOCOL_VERSION } from "./wire-protocol.js";

/** Agent fields the coordinator serializer is allowed to send. */
export const CoordinatorAgentView = z.object({
  id: AgentId,
  role: AgentRole,
  callsign: z.string(),
  position: AgentPosition,
  state: AgentState,
  reportedAt: SimTimeMs,
});
export type CoordinatorAgentView = z.infer<typeof CoordinatorAgentView>;

/**
 * Reportable mission plan for map emphasis (#1). Omits reservation internals; only what the
 * agent would describe on radio.
 */
export const CoordinatorPlanLegView = z.object({
  edgeId: EdgeId,
  direction: z.enum(["forward", "reverse"]),
});
export type CoordinatorPlanLegView = z.infer<typeof CoordinatorPlanLegView>;

export const CoordinatorAgentPlanView = z.object({
  agentId: AgentId,
  planId: MissionPlanId,
  legs: z.array(CoordinatorPlanLegView),
  offroadLegs: z.array(OffroadTimedLeg).optional(),
  workInterval: z.object({ startMs: SimTimeMs, endMs: SimTimeMs }),
  /** When present, distinguishes structure protection from fire suppression on the map. */
  work: MissionWork.optional(),
  refugeId: NodeId,
  phase: z.enum(["approach", "work", "return"]),
  limitingReason: z.string().nullable(),
});
export type CoordinatorAgentPlanView = z.infer<typeof CoordinatorAgentPlanView>;

/** Per-edge earliest/latest modeled fire arrival for coordinator forecast display (#2). */
export const CoordinatorEdgeArrivalBand = z.object({
  edgeId: EdgeId,
  earliestIgnitionMs: SimTimeMs.nullable(),
  latestIgnitionMs: SimTimeMs.nullable(),
});
export type CoordinatorEdgeArrivalBand = z.infer<typeof CoordinatorEdgeArrivalBand>;

export const CoordinatorForecastView = z.object({
  reliability: z.enum(["reliable", "unreliable", "rebuilding"]),
  supportedMemberCount: z.number().int().nonnegative(),
  explanation: z.string().nullable(),
  edgeArrivals: z.array(CoordinatorEdgeArrivalBand),
});
export type CoordinatorForecastView = z.infer<typeof CoordinatorForecastView>;

/**
 * Site as seen by the coordinator: null fields mean not yet observed.
 * Truth values (requiredWork, destroyed from truth) are never included here.
 */
export const CoordinatorSiteView = z.object({
  id: SiteId,
  name: z.string(),
  nodeId: NodeId,
  value: z.number().positive(),
  observedCompletedWork: WorkUnits.nullable(),
  observedDamage: z.number().min(0).max(1).nullable(),
  observedDestroyed: z.boolean().nullable(),
  lastObservedAt: SimTimeMs.nullable(),
  stale: z.boolean(),
});
export type CoordinatorSiteView = z.infer<typeof CoordinatorSiteView>;

/** Fire cell observation delivered to the coordinator. */
export const CoordinatorCellView = z.object({
  gridCellIndex: z.number().int().nonnegative().max(4095),
  burnState: z.enum(["unburned", "burning", "burned"]),
  lastObservedAt: SimTimeMs,
  /** True when lastObservedAt is more than 30 sim-seconds before simTimeMs. */
  stale: z.boolean(),
  observerAgentId: AgentId,
});
export type CoordinatorCellView = z.infer<typeof CoordinatorCellView>;

const CurrentFireCells = z
  .array(z.number().int().nonnegative().max(4095))
  .refine((cells) => cells.every((cell, i) => i === 0 || cell > (cells[i - 1] ?? -1)), {
    message: "cells must be strictly ascending (sorted and unique)",
  });

/**
 * Current fire state for the authorized live coordinator only (#112).
 *
 * Authorization: built solely by projectCoordinator() and sent only on the coordinator's own
 * CoordinatorView stream while the incident is active. Crew AgentProjection, knowledge stores,
 * forecast inputs and navigation never receive it.
 *
 * Contents: cells burning or burned out at simTimeMs. Unburned and nonburnable cells are implied
 * by absence. It never carries private world parameters (spread multiplier, wind shift, seeds),
 * fuel or height layers, burn timers, ignition times, or any future state.
 * `observedCells` keeps its belief and staleness meaning and is unaffected.
 */
export const CoordinatorCurrentFireView = z
  .object({
    /** Tick this snapshot describes; equals CoordinatorView.simTimeMs. */
    simTimeMs: SimTimeMs,
    burningCells: CurrentFireCells,
    burnedCells: CurrentFireCells,
  })
  .refine((fire) => !fire.burningCells.some((cell) => fire.burnedCells.includes(cell)), {
    message: "a cell cannot be both burning and burned",
  });
export type CoordinatorCurrentFireView = z.infer<typeof CoordinatorCurrentFireView>;

/** A cell partly cleared of fuel: fire spreads into it more slowly, in proportion to what is left. */
export const CoordinatorClearingCell = z.object({
  gridCellIndex: z.number().int().nonnegative().max(4095),
  clearance: z.number().gt(0).lt(1),
});
export type CoordinatorClearingCell = z.infer<typeof CoordinatorClearingCell>;

/**
 * A fire line between two map points. Cleared cells also appear in `firebreakCells`. `id` is the
 * same for both directions; `start`/`end` are in canonical order (lower end cell first).
 */
export const CoordinatorFirelineView = z.object({
  id: z.string(),
  start: MapPoint,
  end: MapPoint,
  /** Cells from `start` to `end`. */
  cells: z.array(z.number().int().nonnegative().max(4095)),
  /** No unburned cell is left: every cell is cleared, or the fire took some. */
  resolved: z.boolean(),
});
export type CoordinatorFirelineView = z.infer<typeof CoordinatorFirelineView>;

/** Single entry in the coordinator's transcript (agent-to-coordinator reports). */
export const CoordinatorReportEntry = z.object({
  sequence: SequenceNumber,
  simTimeMs: SimTimeMs,
  agentId: AgentId,
  text: z.string(),
  urgent: z.boolean(),
});
export type CoordinatorReportEntry = z.infer<typeof CoordinatorReportEntry>;

/**
 * The full coordinator projection snapshot produced by projectCoordinator().
 * Contains only whitelisted fields; never exposes privateWorldParameters.
 */
export const CoordinatorView = z.object({
  protocolVersion: z.literal(WIRE_PROTOCOL_VERSION),
  sequence: SequenceNumber,
  simTimeMs: SimTimeMs,
  wallElapsedMs: WallTimeMs,
  incidentStatus: z.enum(["active", "ended"]),
  activeRecipientId: AgentId.nullable(),
  agents: z.array(CoordinatorAgentView),
  sites: z.array(CoordinatorSiteView),
  observedCells: z.array(CoordinatorCellView),
  /** Authorized live current fire (#112); absent when the sender does not provide it. */
  currentFire: CoordinatorCurrentFireView.optional(),
  /**
   * Firebreak cells: ground cleared of fuel, which never ignites. Public map knowledge (no private
   * parameters), sorted and unique like the current-fire lists; absent when there are none.
   */
  firebreakCells: CurrentFireCells.optional(),
  /** Cells partly cleared toward a firebreak (0 < clearance < 1), ascending by cell; absent when none. */
  clearingCells: z.array(CoordinatorClearingCell).optional(),
  /** Fire lines crews have been sent to build, with their cells from one end to the other. */
  firelines: z.array(CoordinatorFirelineView).optional(),
  /** Active reportable plans per agent (empty when idle). */
  agentPlans: z.array(CoordinatorAgentPlanView),
  /** Coordinator forecast envelope for the map; null before the first build. */
  coordinatorForecast: CoordinatorForecastView.nullable(),
  recentReports: z.array(CoordinatorReportEntry),
  /** Latest containment completions visible to the coordinator (not structure protection). */
  recentContainmentResults: z.array(ContainmentWorkResult).optional(),
  incidentEnd: IncidentEnd.nullable(),
});
export type CoordinatorView = z.infer<typeof CoordinatorView>;
