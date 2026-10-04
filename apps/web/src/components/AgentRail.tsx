import type { CoordinatorAgentPlanView, CoordinatorAgentView } from "@ember/domain";
import { displayState } from "./scene/models/markerCues.js";
import { CREW_STATE_LABEL } from "./crewDetails.js";

export interface AgentRailProps {
  readonly agents: CoordinatorAgentView[];
  /** Current plans, so a crew on its return leg reads "Returning" rather than "Approaching". */
  readonly plans?: readonly CoordinatorAgentPlanView[];
  readonly selectedAgentId: string | null;
  readonly onSelectAgent: (agentId: string) => void;
}

/**
 * The demo presents crews only (#118). A view that still carries another role (an old recording, or a
 * sim that predates #117) gets a neutral label here; the callsign comes from the data.
 */
const ROLE_LABEL: Record<CoordinatorAgentView["role"], string> = {
  protection_crew: "Crew",
  scout: "Agent",
};

/**
 * Lower scene rail: compact agent cards. Selecting one inspects/follows it
 * in the scene but is kept entirely separate from the conversation's
 * active recipient (docs/FRONTEND.md).
 */
export function AgentRail({ agents, plans = [], selectedAgentId, onSelectAgent }: AgentRailProps) {
  return (
    <ul className="agent-rail" aria-label="Crews: select one to inspect it on the map">
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
            <span className="agent-rail__state">{CREW_STATE_LABEL[displayState(agent.state, plans.find((plan) => plan.agentId === agent.id)?.phase)]}</span>
            {agent.id === selectedAgentId ? <span className="agent-rail__inspecting">Inspecting</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
