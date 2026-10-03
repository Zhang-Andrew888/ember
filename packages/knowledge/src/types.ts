import type { AgentId, Observation, SequenceNumber, SimTimeMs } from "@ember/domain";

/** Scoped knowledge snapshot for one agent at one revision. */
export interface AgentKnowledgeSnapshot {
  readonly agentId: AgentId;
  readonly revision: SequenceNumber;
  readonly asOfSimTimeMs: SimTimeMs;
  readonly observations: readonly Observation[];
}
