import type { CoordinatorAgentView } from "@ember/domain";

export interface AgentRailProps {
  readonly agents: CoordinatorAgentView[];
  readonly selectedAgentId: string | null;
  readonly onSelectAgent: (agentId: string) => void;
}

const ROLE_LABEL: Record<CoordinatorAgentView["role"], string> = {
  protection_crew: "Crew",
  scout: "Scout",
};

const STATE_LABEL: Record<CoordinatorAgentView["state"], string> = {
  idle: "Idle",
  approaching: "Approaching",
  working: "Working",
  withdrawing: "Withdrawing",
  retreating: "Retreating",
  lost: "Lost",
};

/**
 * Lower scene rail: compact agent cards. Selecting one inspects/follows it
 * in the scene but is kept entirely separate from the conversation's
 * active recipient (docs/FRONTEND.md).
 */
export function AgentRail({ agents, selectedAgentId, onSelectAgent }: AgentRailProps) {
  return (
    <ul className="agent-rail" aria-label="Agents">
      {agents.map((agent) => (
        <li key={agent.id}>
          <button
            type="button"
            className="agent-rail__card"
            aria-pressed={agent.id === selectedAgentId}
            onClick={() => onSelectAgent(agent.id)}
          >
            <span className="agent-rail__callsign">{agent.callsign}</span>
            <span className="agent-rail__role">{ROLE_LABEL[agent.role]}</span>
            <span className="agent-rail__state">{STATE_LABEL[agent.state]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
