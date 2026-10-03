import type { AgentId, DecisionEvent, Objective, SimTimeMs } from "@ember/domain";

export interface AgentController {
  readonly agentId: AgentId;
  tick(simTimeMs: SimTimeMs): Promise<DecisionEvent | null>;
  receiveObjective(objective: Objective): void;
}
