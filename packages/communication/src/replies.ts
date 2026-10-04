import type { DecisionEvent } from "@ember/domain";
import type { SpeechTier } from "./speech.js";

export type Phrasing = "plain" | "radio";

export interface Reply {
  readonly text: string;
  readonly tier: SpeechTier;
}

const REASONS: Record<string, string> = {
  forecast_leg_unsafe: "The forecast no longer certifies the road ahead.",
  forecast_wait_unsafe: "Waiting here is no longer safe.",
  forecast_work_unsafe: "Work can no longer finish with a safe return.",
  forecast_horizon: "Forecast support ends before the return would finish.",
  forecast_unreliable: "Our forecast was contradicted.",
  route_closed_by_observation: "Our observation closed the planned route.",
  target_resolved: "The site is already protected or lost.",
  no_normal_return: "No normal return passes the margin.",
  no_known_passable_route: "No known passable route to refuge.",
  no_feasible_mission_in_model: "No safe mission found.",
  reservation_conflict: "The road slot changed.",
  yielded_to_higher_priority: "Another crew needs the road first.",
  objective_accepted: "Coordinator objective accepted.",
  mission_admitted: "",
};

/**
 * Build speech from a committed, reason-coded decision. Plain language is the default; radio
 * phrasing puts the callsign first and shortens sentences without changing the facts or hiding
 * uncertainty.
 */
export function replyForDecision(callsign: string, d: DecisionEvent, phrasing: Phrasing = "plain"): Reply {
  const reason = REASONS[d.reasonCode] ?? "";
  const tier: SpeechTier =
    d.type === "stranded_reported" || d.type === "retreat_triggered" ? 1 : d.type === "withdrawal_triggered" ? 2 : d.type === "objective_rejected" ? 3 : 4;
  const action = d.actualAction;
  let text: string;
  switch (d.type) {
    case "withdrawal_triggered":
      text = phrasing === "radio" ? `${callsign}, withdrawing. ${reason}` : `${callsign} is withdrawing. ${reason}`;
      break;
    case "retreat_triggered":
      text = phrasing === "radio" ? `${callsign}, retreating, best effort. ${reason}` : `${callsign} is retreating to refuge. ${reason}`;
      break;
    case "stranded_reported":
      text = phrasing === "radio" ? `${callsign}, stranded. ${reason}` : `${callsign} is stranded. ${reason}`;
      break;
    case "objective_rejected":
      text = phrasing === "radio" ? `${callsign}, cannot comply. ${reason || action}` : `${callsign} cannot do that and return with the required margin. ${reason}`;
      break;
    case "mission_update":
      if (d.reasonCode === "yielded_to_higher_priority") {
        text = phrasing === "radio" ? `${callsign}, yielding the road and replanning. ${reason}` : `${callsign} is yielding the road and replanning. ${reason}`;
        break;
      }
      text = phrasing === "radio" ? `${callsign}, ${action}.` : `${callsign} is ${action}.`;
      break;
    case "mission_start":
      text = phrasing === "radio" ? `${callsign}, ${action}.` : `${callsign} is ${action}.`;
      break;
    case "idle":
      text = phrasing === "radio" ? `${callsign}, holding. ${reason}` : `${callsign} is holding. ${reason}`;
      break;
    case "containment_succeeded":
      text = phrasing === "radio" ? `${callsign}, containment holding. ${action}` : `${callsign} reports containment holding. ${action}`;
      break;
    case "containment_failed":
      text =
        phrasing === "radio"
          ? `${callsign}, containment failed. ${reason || action}`
          : `${callsign} could not hold containment. ${reason || action}`;
      break;
  }
  return { text: text.replace(/\s+/g, " ").trim(), tier };
}

/** Loss comes from the simulator's own control narration, never as an utterance by the lost crew. */
export function lossNarration(callsign: string): Reply {
  return { text: `Control: ${callsign} has been lost.`, tier: 1 };
}
