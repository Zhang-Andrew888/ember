import { useEffect, useRef } from "react";
import type { IncidentEnd } from "@ember/domain";
import { formatIncidentClock } from "../format/time.js";
import { endReasonDisplayText } from "../format/endReason.js";

export interface EndOverlayProps {
  readonly incidentEnd: IncidentEnd;
  readonly onStartAgain: () => void;
}

/**
 * Ending overlay: freezes on the actual end state, states the display
 * reason, and offers replay/start-again (docs/FRONTEND.md). Full replay
 * (Slice 7) isn't implemented yet, so that action is disabled with an
 * honest explanation rather than a fake no-op button.
 *
 * App.tsx makes the rest of the page `inert` while this is up, so
 * aria-modal is accurate; this also moves focus to the heading on mount
 * (standard modal-dialog practice) rather than leaving it wherever it was
 * on the now-inert background.
 */
export function EndOverlay({ incidentEnd, onStartAgain }: EndOverlayProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="end-overlay" role="dialog" aria-modal="true" aria-labelledby="end-overlay-heading">
      <h1 id="end-overlay-heading" ref={headingRef} tabIndex={-1}>
        Incident ended
      </h1>
      <p className="end-overlay__reason">{endReasonDisplayText(incidentEnd.displayReason)}</p>
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
