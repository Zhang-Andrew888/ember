import type { CoordinatorView } from "@ember/domain";
import { siteDamageLabel, siteProtectionStatus, siteProtectionStatusLabel } from "../format/reports.js";
import { formatIncidentClock } from "../format/time.js";
import { displayState } from "./scene/models/markerCues.js";
import { CREW_STATE_LABEL } from "./crewDetails.js";

export interface ObservedSiteOutcome {
  readonly id: string;
  readonly name: string;
  /** Protection status plus reported work, e.g. "protection underway (120 work units reported)". */
  readonly status: string;
  readonly damage: string;
  readonly observedAt: string;
}

export interface ObservedCrewOutcome {
  readonly callsign: string;
  readonly state: string;
}

export interface ObservedOutcomes {
  readonly sites: readonly ObservedSiteOutcome[];
  readonly crews: readonly ObservedCrewOutcome[];
}

/**
 * Debrief from the coordinator's own final view. Only observed values are used: no score, no
 * completion threshold, and no truth the coordinator did not see.
 */
export function observedOutcomes(view: CoordinatorView): ObservedOutcomes {
  const sites = [...view.sites]
    .sort((a, b) => b.value - a.value)
    .map((site) => {
      const status = siteProtectionStatusLabel(siteProtectionStatus(site));
      const work = site.observedCompletedWork;
      return {
        id: site.id as string,
        name: site.name,
        status: work !== null && work > 0 && !site.observedDestroyed ? `${status} (${Math.round(work)} work units reported)` : status,
        damage:
          site.observedDamage === null ? "not observed" : (siteDamageLabel(site.observedDamage) ?? "no damage observed"),
        observedAt:
          site.lastObservedAt === null
            ? "never"
            : `${formatIncidentClock(site.lastObservedAt)}${site.stale ? " (stale)" : ""}`,
      };
    });
  const crews = view.agents.map((agent) => ({
    callsign: agent.callsign,
    state: CREW_STATE_LABEL[displayState(agent.state, view.agentPlans.find((plan) => plan.agentId === agent.id)?.phase)],
  }));
  return { sites, crews };
}
