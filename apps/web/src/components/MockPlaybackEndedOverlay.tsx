import { useEffect, useRef } from "react";

export interface MockPlaybackEndedOverlayProps {
  readonly onReload: () => void;
}

/**
 * Shown when the in-browser mock socket exhausts its scripted timeline without
 * an incident end (legacy three-snapshot harness). Recorded demo playback
 * should reach `incidentEnd` instead; this covers dev scenarios and failures.
 */
export function MockPlaybackEndedOverlay({ onReload }: MockPlaybackEndedOverlayProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="mock-playback-ended" role="dialog" aria-modal="true" aria-labelledby="mock-playback-ended-heading">
      <h1 id="mock-playback-ended-heading" ref={headingRef} tabIndex={-1}>
        Mock playback ended
      </h1>
      <p>
        The in-browser demo has no further coordinator snapshots. This is not a live simulation stall — use{" "}
        <code>scripts/demo.sh</code> for a full server-backed run.
      </p>
      <button type="button" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}
