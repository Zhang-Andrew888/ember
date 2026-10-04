import { agentLabelText } from "./models/markerCues.js";
import { siteDamageLabel, siteProtectionStatusLabel } from "../../format/reports.js";
import type { AgentMarker, SiteMarker } from "./sceneEntities.js";
import { freshness, staleObservationTooltip } from "./staleness.js";

/** Map overlay text for an agent: no embedded age phrase (stale styling + tooltip instead). */
export function agentMapLabelText(agent: AgentMarker): string {
  return agentLabelText(agent.callsign, agent.state);
}

export function agentMapLabelMeta(agent: AgentMarker, simTimeMs: number | null): { stale: boolean; title?: string } {
  const fresh = freshness(agent.ageMs);
  const title = simTimeMs === null ? undefined : staleObservationTooltip(simTimeMs, agent.ageMs);
  return { stale: fresh.stale, ...(title === undefined ? {} : { title }) };
}

/** Map overlay text for a site: status and damage only; staleness is visual + tooltip. */
export function siteMapLabelText(site: SiteMarker): string {
  const damageLabel = siteDamageLabel(site.damage);
  const protection = site.protectionStatus === "unprotected"
    ? "no protection completed"
    : siteProtectionStatusLabel(site.protectionStatus);
  return `${site.name}: ${protection}${damageLabel ? `, ${damageLabel}` : ""}`;
}

export function siteMapLabelMeta(site: SiteMarker, simTimeMs: number | null): { stale: boolean; title?: string } {
  const fresh = freshness(site.ageMs, site.stale);
  const showStale = fresh.stale && site.ageMs !== null;
  const title =
    simTimeMs === null || !showStale ? undefined : staleObservationTooltip(simTimeMs, site.ageMs, site.stale);
  return { stale: showStale, ...(title === undefined ? {} : { title }) };
}
