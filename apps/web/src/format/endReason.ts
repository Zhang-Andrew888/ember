import type { EndReason } from "@ember/domain";

const DISPLAY_REASON_TEXT: Record<EndReason, string> = {
  all_protection_crews_lost: "All protection crews were lost.",
  all_sites_resolved: "All sites were resolved (protected or destroyed).",
  fire_extinguished: "The fire was extinguished.",
  time_expired: "The five-minute incident window expired.",
};

/** Human-readable sentence for an IncidentEnd's displayReason (debrief screen). */
export function endReasonDisplayText(reason: EndReason): string {
  return DISPLAY_REASON_TEXT[reason];
}
