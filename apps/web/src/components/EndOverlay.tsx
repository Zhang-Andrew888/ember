import type { IncidentEnd } from "@ember/domain";
import { formatIncidentClock } from "../format/time.js";

export interface EndOverlayProps {
  readonly incidentEnd: IncidentEnd;
  readonly onStartAgain: () => void;
}

const DISPLAY_REASON_TEXT: Record<IncidentEnd["displayReason"], string> = {
  all_protection_crews_lost: "All protection crews were lost.",
  all_sites_resolved: "All sites were resolved (protected or destroyed).",
  fire_extinguished: "The fire was extinguished.",
  time_expired: "The five-minute incident window expired.",
};

/**
 * Ending overlay: freezes on the actual end state, states the display
 * reason, and offers replay/start-again (docs/FRONTEND.md). Full replay
 * (Slice 7) isn't implemented yet, so that action is disabled with an
 * honest explanation rather than a fake no-op button.
 */
export function EndOverlay({ incidentEnd, onStartAgain }: EndOverlayProps) {
  return (
    <div className="end-overlay" role="dialog" aria-labelledby="end-overlay-heading">
      <h1 id="end-overlay-heading">Incident ended</h1>
      <p className="end-overlay__reason">{DISPLAY_REASON_TEXT[incidentEnd.displayReason]}</p>
      <dl className="end-overlay__facts">
        <dt>Incident time</dt>
        <dd>{formatIncidentClock(incidentEnd.tick)}</dd>
        <dt>Other matching end conditions</dt>
        <dd>
          {incidentEnd.matchingReasons.filter((reason) => reason !== incidentEnd.displayReason).join(", ") ||
            "none"}
        </dd>
      </dl>
      <div className="end-overlay__actions">
        <button type="button" onClick={onStartAgain}>
          Start again
        </button>
        <button type="button" disabled title="Full replay lands in Slice 7">
          Replay (not yet available)
        </button>
      </div>
    </div>
  );
}
