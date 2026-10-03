import type { DecisionEvent } from "@ember/domain";

/** Short human sentence built from the structured reason code, never from free-form guesses. */
export function explain(callsign: string, decision: Pick<DecisionEvent, "type" | "reasonCode" | "actualAction">, detail = ""): string {
  const why = reasonText(decision.reasonCode);
  switch (decision.type) {
    case "mission_start":
      return `${callsign} is ${decision.actualAction}.`;
    case "mission_update":
      return `${callsign} changed plan: ${decision.actualAction}.`;
    case "withdrawal_triggered":
      return `${callsign} is withdrawing. ${why}`;
    case "retreat_triggered":
      return `${callsign} is retreating to refuge. ${why}`;
    case "stranded_reported":
      return `${callsign} is stranded. ${why}`;
    case "objective_rejected":
      return `${callsign} cannot do that and return with the required margin.${detail === "" ? "" : ` ${detail}`}`;
    case "idle":
      return `${callsign} is holding. ${why}`;
  }
}

function reasonText(code: string): string {
  switch (code) {
    case "forecast_leg_unsafe":
      return "The forecast no longer certifies the road ahead with the required margin.";
    case "forecast_wait_unsafe":
      return "Waiting here is no longer safe under the forecast.";
    case "forecast_work_unsafe":
      return "The work interval can no longer be completed with a safe return.";
    case "forecast_horizon":
      return "Forecast support ends before the return would finish.";
    case "forecast_unreliable":
      return "Observations contradicted every forecast member, so the forecast is unreliable.";
    case "route_closed_by_observation":
      return "A direct observation closed the planned route.";
    case "target_resolved":
      return "The site is already protected or lost.";
    case "no_normal_return":
      return "No return passes the normal margin, so it is taking the lowest-exposure known road.";
    case "no_known_passable_route":
      return "No known passable route to a refuge; observing and reporting.";
    case "no_feasible_mission_in_model":
      return "No mission with a safe return was found in this model.";
    case "no_unresolved_target":
      return "No unresolved site remains.";
    case "forecast_horizon_insufficient":
      return "Forecast support is too short for any mission.";
    default:
      return "";
  }
}
