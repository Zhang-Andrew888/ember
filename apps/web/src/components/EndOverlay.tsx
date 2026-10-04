import { useEffect, useRef } from "react";
import type { CoordinatorView, IncidentEnd } from "@ember/domain";
import { formatElapsedWallTime, formatIncidentClock } from "../format/time.js";
import { endReasonDisplayText } from "../format/endReason.js";
import { observedOutcomes } from "./observedOutcomes.js";

export type ReplayOffer = "this-run" | "illustrative" | "none";

export interface EndOverlayProps {
  readonly incidentEnd: IncidentEnd;
  /** Final coordinator view, for the observed outcome summary. */
  readonly view?: CoordinatorView | null;
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
  view = null,
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

  const otherReasons = incidentEnd.matchingReasons
    .filter((reason) => reason !== incidentEnd.displayReason)
    .map(endReasonDisplayText);
  const outcomes = view === null ? null : observedOutcomes(view);

  return (
    <div className="end-overlay" role="dialog" aria-modal="true" aria-labelledby="end-overlay-heading">
      <div className="end-overlay__content">
        <h1 id="end-overlay-heading" ref={headingRef} tabIndex={-1}>
          Incident ended
        </h1>
        <p className="end-overlay__reason">{endReasonDisplayText(incidentEnd.displayReason)}</p>
        <dl className="end-overlay__facts">
          <dt>Simulated time</dt>
          <dd>{formatIncidentClock(incidentEnd.tick)}</dd>
          <dt>Real time</dt>
          <dd>{formatElapsedWallTime(incidentEnd.wallElapsedMs)}</dd>
        </dl>
        {outcomes !== null ? (
          <section className="end-overlay__outcomes" aria-labelledby="end-overlay-outcomes-heading">
            <h2 id="end-overlay-outcomes-heading">What you observed</h2>
            <p className="end-overlay__outcomes-note">
              As last reported to you. Work counts are reported effort; the simulation does not report when a site is
              fully protected.
            </p>
            {outcomes.sites.length > 0 ? (
              <table className="end-overlay__table">
                <caption className="sr-only">Sites</caption>
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Status</th>
                    <th scope="col">Damage</th>
                    <th scope="col">Last observed</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.sites.map((site) => (
                    <tr key={site.id}>
                      <th scope="row">{site.name}</th>
                      <td>{site.status}</td>
                      <td>{site.damage}</td>
                      <td>{site.observedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {outcomes.crews.length > 0 ? (
              <p className="end-overlay__crews">
                Crews: {outcomes.crews.map((crew) => `${crew.callsign} ${crew.state.toLowerCase()}`).join(", ")}.
              </p>
            ) : null}
          </section>
        ) : null}
        {otherReasons.length > 0 ? (
          <details className="end-overlay__secondary">
            <summary>Other end conditions also met ({otherReasons.length})</summary>
            <p>{otherReasons.join(" ")}</p>
          </details>
        ) : null}
        <div className="end-overlay__actions">
          {replayOffer !== "none" ? (
            <button type="button" onClick={onReplay} disabled={replayLoading}>
              {replayLoading
                ? "Loading replay…"
                : replayOffer === "illustrative"
                  ? "Replay (illustrative sample, not this run)"
                  : "Replay this run"}
            </button>
          ) : null}
          <button type="button" onClick={onStartAgain}>
            Start again
          </button>
        </div>
        {replayError !== null && replayError.length > 0 ? (
          <p className="end-overlay__error" role="alert">
            {replayError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
