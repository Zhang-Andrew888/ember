import type { CoordinatorAgentPlanView, CoordinatorAgentView, CoordinatorSiteView, MissionWork } from "@ember/domain";
import { displayState, type AgentDisplayState } from "./scene/models/markerCues.js";
import { limitingReasonDisplayText } from "../format/limitingReason.js";
import { formatIncidentClock } from "../format/time.js";
import { gridCellRowColumn } from "./scene/tileInspection.js";

export const CREW_STATE_LABEL: Record<AgentDisplayState, string> = {
  idle: "Idle",
  approaching: "Approaching",
  returning: "Returning",
  working: "Working",
  withdrawing: "Withdrawing",
  retreating: "Retreating",
  lost: "Lost",
};

export interface CrewDetails {
  readonly agentId: string;
  readonly callsign: string;
  readonly stateLabel: string;
  /** Incident time of the crew's last report and how old it is in incident time. */
  readonly reported: string;
  /** What the crew reports it is doing; null when it has no reportable plan. */
  readonly objective: string | null;
  readonly limitingReason: string | null;
}

/** Work class from the reportable plan. Legacy plans without `work` imply structure protection. */
export function describeWork(work: MissionWork | undefined, sites: readonly CoordinatorSiteView[]): string {
  if (work === undefined) return "structure protection";
  if (work.kind === "protect_structure") {
    const site = sites.find((candidate) => candidate.id === work.siteId);
    return `structure protection at ${site?.name ?? "a site"}`;
  }
  if (work.kind === "build_line") return "fire line construction";
  const { row, column } = gridCellRowColumn(work.gridCellIndex);
  return `fire suppression at row ${row}, column ${column}`;
}

const PHASE_PREFIX: Record<CoordinatorAgentPlanView["phase"], string> = {
  approach: "Heading out for",
  work: "Doing",
  return: "Returning to refuge after",
};

/** Selected-crew summary built only from coordinator-reported fields. */
export function describeCrew(
  agent: CoordinatorAgentView,
  plan: CoordinatorAgentPlanView | undefined,
  sites: readonly CoordinatorSiteView[],
  simTimeMs: number | null,
): CrewDetails {
  const reportedAt = agent.reportedAt as number;
  const ageSeconds = simTimeMs === null ? null : Math.max(0, Math.round((simTimeMs - reportedAt) / 1000));
  return {
    agentId: agent.id as string,
    callsign: agent.callsign,
    stateLabel: CREW_STATE_LABEL[displayState(agent.state, plan?.phase)],
    reported:
      ageSeconds === null
        ? `${formatIncidentClock(reportedAt)} incident time`
        : `${formatIncidentClock(reportedAt)} incident time (${ageSeconds} s of incident time ago)`,
    objective: plan === undefined ? null : `${PHASE_PREFIX[plan.phase]} ${describeWork(plan.work, sites)}`,
    limitingReason: plan?.limitingReason ? limitingReasonDisplayText(plan.limitingReason) : null,
  };
}
