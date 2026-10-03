import type { CoordinatorView } from "./coordinator-view.js";
import type { CommandReceipt, DecisionEvent, IncidentEnd, Observation } from "./records.js";
import type { AgentId, IncidentId } from "./ids.js";
import type { SimTimeMs } from "./units.js";

export interface IncidentHandle {
  readonly id: IncidentId;
  readonly scenarioVersion: string;
  readonly startedAt: Date;
}

export type DomainEvent =
  | { readonly kind: "observation"; readonly payload: Observation }
  | { readonly kind: "decision"; readonly payload: DecisionEvent }
  | { readonly kind: "receipt"; readonly payload: CommandReceipt }
  | { readonly kind: "incident_end"; readonly payload: IncidentEnd };

export interface ValidatedCommand {
  readonly commandId: string;
  readonly recipientId: AgentId;
  readonly text: string;
  readonly idempotencyKey: string;
}

export interface ScopedPlanningInput {
  readonly agentId: AgentId;
  readonly knowledgeRevision: number;
  // Full planning input fields added when packages/navigation is implemented
}

export interface PlanResult {
  readonly feasible: boolean;
  readonly plan: unknown | null;
  readonly limitingReason: string | null;
}

export interface ReplayResult {
  readonly events: DomainEvent[];
  readonly finalView: CoordinatorView;
  readonly matchesOriginal: boolean;
}

/**
 * Public simulation interface as specified in ARCHITECTURE.md.
 * Names here are the contracted interface; implementations live in packages/simulation.
 */
export interface SimulationAPI {
  createIncident(config: unknown, privateWorldSeed: string): IncidentHandle;
  advance(handle: IncidentHandle, dueTicks: SimTimeMs): DomainEvent[];
  enqueueCommand(handle: IncidentHandle, command: ValidatedCommand): CommandReceipt;
  projectCoordinator(handle: IncidentHandle): CoordinatorView;
  projectAgent(handle: IncidentHandle, agentId: AgentId): unknown;
  evaluateMission(input: ScopedPlanningInput): PlanResult;
  replay(log: DomainEvent[], scenarioVersion: string): ReplayResult;
}
