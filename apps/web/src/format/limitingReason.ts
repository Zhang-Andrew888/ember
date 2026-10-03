/** Coordinator-facing labels for agentPlans[].limitingReason (route scene labels). */
const LIMITING_REASON_LABEL: Record<string, string> = {
  work_interval_limited_by_forecast: "work window limited by forecast",
  no_feasible_mission_in_model: "no feasible mission in the model",
  forecast_horizon_insufficient: "forecast horizon insufficient",
  forecast_unreliable: "forecast unreliable",
  forecast_leg_unsafe: "forecast leg unsafe",
  best_effort_retreat: "best-effort retreat",
  stranded_halt: "stranded; holding position",
};

/** Plain-language route label suffix for a limitingReason code from the server. */
export function limitingReasonDisplayText(reason: string): string {
  const mapped = LIMITING_REASON_LABEL[reason];
  if (mapped !== undefined) return mapped;
  return reason.replace(/[_-]+/g, " ").trim();
}
