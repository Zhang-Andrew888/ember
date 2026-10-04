import type { CoordinatorView } from "@ember/domain";

/**
 * The demo presents crews only (#118). The shared `AgentRole` schema still has "scout" and this
 * module does not touch it: it only filters the mock, recorded and briefing sources the web app
 * owns, so a new demo session never shows a scout marker, rail card, report or prompt.
 *
 * Real views that still carry a scout (an old recording, or a sim that predates #117) are NOT
 * filtered on the live path; the scene and rail render such an agent as an ordinary marker.
 */
export function omitScoutFromView(view: CoordinatorView): CoordinatorView {
  const scoutIds = new Set(view.agents.filter((agent) => agent.role === "scout").map((agent) => agent.id as string));
  if (scoutIds.size === 0) return view;
  return {
    ...view,
    agents: view.agents.filter((agent) => !scoutIds.has(agent.id as string)),
    agentPlans: view.agentPlans.filter((plan) => !scoutIds.has(plan.agentId as string)),
    recentReports: view.recentReports.filter((report) => !scoutIds.has(report.agentId as string)),
    activeRecipientId:
      view.activeRecipientId !== null && scoutIds.has(view.activeRecipientId as string) ? null : view.activeRecipientId,
    // observedCells keep their fire evidence; observerAgentId is required by the schema and is never shown.
  };
}

/** Callsigns for the briefing roster without any scout entry. */
export function omitScoutCallsigns(callsigns: readonly string[]): string[] {
  return callsigns.filter((callsign) => !/\bscout\b/i.test(callsign));
}
