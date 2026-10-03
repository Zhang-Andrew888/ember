import type { CoordinatorReportEntry, CoordinatorView } from "@ember/domain";

/** Most recent urgent report, for the persistent urgent strip. Null when none yet. */
export function latestUrgentReport(view: CoordinatorView): CoordinatorReportEntry | null {
  let latest: CoordinatorReportEntry | null = null;
  for (const report of view.recentReports) {
    if (!report.urgent) continue;
    if (!latest || report.sequence > latest.sequence) latest = report;
  }
  return latest;
}

/** Routine (non-urgent) reports in chronological order, for the transcript. */
export function routineReports(view: CoordinatorView): CoordinatorReportEntry[] {
  return view.recentReports
    .filter((report) => !report.urgent)
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
}

export type SiteProtectionStatus = "unobserved" | "unprotected" | "partially_protected" | "destroyed";

/**
 * Site protection and site damage are reported separately in the UI
 * (docs/FRONTEND.md: "60% protected is not 60% health"). This only derives
 * the protection-side category; damage is rendered from observedDamage directly.
 */
export function siteProtectionStatus(site: CoordinatorView["sites"][number]): SiteProtectionStatus {
  if (site.observedDestroyed) return "destroyed";
  if (site.observedCompletedWork === null) return "unobserved";
  return site.observedCompletedWork > 0 ? "partially_protected" : "unprotected";
}
