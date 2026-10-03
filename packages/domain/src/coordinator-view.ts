import { z } from "zod";
import { AgentId, NodeId, SiteId } from "./ids.js";
import { SequenceNumber, SimTimeMs, WallTimeMs, WorkUnits } from "./units.js";
import { AgentPosition } from "./position.js";
import { AgentRole, AgentState, IncidentEnd } from "./records.js";

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
  edgeId: z.string(),
  cellIndex: z.number().int().nonnegative(),
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
  sequence: SequenceNumber,
  simTimeMs: SimTimeMs,
  wallElapsedMs: WallTimeMs,
  incidentStatus: z.enum(["active", "ended"]),
  activeRecipientId: AgentId.nullable(),
  agents: z.array(CoordinatorAgentView),
  sites: z.array(CoordinatorSiteView),
  observedCells: z.array(CoordinatorCellView),
  recentReports: z.array(CoordinatorReportEntry),
  incidentEnd: IncidentEnd.nullable(),
});
export type CoordinatorView = z.infer<typeof CoordinatorView>;
