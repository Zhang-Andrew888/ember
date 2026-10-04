import { z } from "zod";
import { AgentId, EdgeId, MissionPlanId, NodeId, SiteId } from "./ids.js";
import { SequenceNumber, SimTimeMs, WallTimeMs, WorkUnits } from "./units.js";
import { AgentPosition } from "./position.js";
import { AgentRole, AgentState, ContainmentWorkResult, IncidentEnd, MissionWork } from "./records.js";
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
