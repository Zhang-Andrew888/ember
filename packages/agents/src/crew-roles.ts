import type { AgentRole } from "@ember/domain";
import { SIM_DEFAULTS } from "@ember/simulation/model";

/**
 * Typed per-role capabilities, taken from the documented defaults (docs/SIMULATION.md: agent speed
 * and crew work rate; docs/NAVIGATION_AGENTS.md: a crew estimates contribution from its own work
 * rate). Roles are the wire roles from @ember/domain; nothing here is a new contract.
 */
export interface CrewCapabilities {
  /** Travel speed in metres per simulated second. */
  readonly speedMps: number;
  /** Site work units per simulated second while protecting. A scout does not protect: 0. */
  readonly workRate: number;
}

export const CREW_CAPABILITIES: Readonly<Record<AgentRole, CrewCapabilities>> = {
  protection_crew: { speedMps: SIM_DEFAULTS.agentSpeedMps, workRate: SIM_DEFAULTS.crewWorkRate },
  scout: { speedMps: SIM_DEFAULTS.agentSpeedMps, workRate: 0 },
};

export function capabilitiesOf(role: AgentRole): CrewCapabilities {
  return CREW_CAPABILITIES[role];
}
