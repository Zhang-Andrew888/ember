import { useEffect, useRef } from "react";
import type { IncidentEnd } from "@ember/domain";
import { formatElapsedWallTime, formatIncidentClock } from "../format/time.js";
import { endReasonDisplayText } from "../format/endReason.js";

export type ReplayOffer = "this-run" | "illustrative" | "none";

export interface EndOverlayProps {
  readonly incidentEnd: IncidentEnd;
  readonly onStartAgain: () => void;
  readonly onReplay: () => void;
  readonly replayOffer: ReplayOffer;
  readonly replayLoading?: boolean;
  readonly replayError?: string | null;
}

/**
 * Ending overlay: freezes on the actual end state, states the display
 * reason, and offers replay/start-again (docs/FRONTEND.md). Replay opens
 * Replay: live REST sessions fetch this run's export; mock demo uses an
 * illustrative sample (labeled in ReplayView).
 *
 * App.tsx makes the rest of the page `inert` while this is up, so
 * aria-modal is accurate; this also moves focus to the heading on mount
 * (standard modal-dialog practice) rather than leaving it wherever it was
 * on the now-inert background.
 */
export function EndOverlay({
  incidentEnd,
  onStartAgain,
  onReplay,
  replayOffer,
  replayLoading = false,
  replayError = null,
}: EndOverlayProps) {
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
        <dt>Simulated time</dt>
        <dd>{formatIncidentClock(incidentEnd.tick)}</dd>
        <dt>Real time</dt>
        <dd>{formatElapsedWallTime(incidentEnd.wallElapsedMs)}</dd>
        <dt>Other matching end conditions</dt>
        <dd>
          {incidentEnd.matchingReasons
            .filter((reason) => reason !== incidentEnd.displayReason)
            .map(endReasonDisplayText)
            .join(" ") || "none"}
        </dd>
      </dl>
      <div className="end-overlay__actions">
        <button type="button" onClick={onStartAgain}>
          Start again
        </button>
        {replayOffer !== "none" ? (
          <button type="button" onClick={onReplay} disabled={replayLoading}>
            {replayLoading
              ? "Loading replay…"
              : replayOffer === "illustrative"
                ? "Replay (illustrative sample)"
                : "Replay this run"}
          </button>
        ) : null}
      </div>
      {replayError !== null && replayError.length > 0 ? (
        <p className="end-overlay__error" role="alert">
          {replayError}
        </p>
      ) : null}
    </div>
  );
}
