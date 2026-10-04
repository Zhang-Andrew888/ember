import type { CoordinatorReportEntry } from "@ember/domain";
import { formatIncidentClock } from "../format/time.js";

export interface UrgentStripProps {
  readonly report: CoordinatorReportEntry | null;
  readonly callsign: string | null;
  readonly audioState: "idle" | "pending" | "playing";
  readonly queuedUrgent: boolean;
  /** True when the audio state comes from the timing stub, not real playback. */
  readonly audioSimulated?: boolean;
  /** Earlier urgent reports of this run, newest first (the current one excluded). */
  readonly history?: readonly CoordinatorReportEntry[];
  readonly callsignFor?: (agentId: string) => string;
  /** Selects the reporting crew for inspection; never addresses or commands it. */
  readonly onInspectCrew?: (agentId: string) => void;
}

function audioText(audioState: UrgentStripProps["audioState"], queuedUrgent: boolean, simulated: boolean): string | null {
  const prefix = simulated ? "Simulated audio" : "Audio";
  if (audioState === "playing") return `${prefix} playing`;
  if (audioState === "pending") return `${prefix} preparing`;
  if (queuedUrgent) return `${prefix} next`;
  return null;
}

/**
 * Persistent urgent strip above the composer (docs/FRONTEND.md). Only the report itself sits in
 * the alert region, so each urgent report is announced once regardless of focus, and audio-state
 * changes are not re-announced. Never conveyed by color alone.
 */
export function UrgentStrip({
  report,
  callsign,
  audioState,
  queuedUrgent,
  audioSimulated = false,
  history = [],
  callsignFor = (agentId) => agentId,
  onInspectCrew,
}: UrgentStripProps) {
  if (!report) {
    return (
      <div className="urgent-strip urgent-strip--empty" role="status">
        No urgent reports.
      </div>
    );
  }

  const audio = audioText(audioState, queuedUrgent, audioSimulated);
  return (
    <div className="urgent-strip urgent-strip--active">
      <div className="urgent-strip__report" role="alert">
        <span className="urgent-strip__label">Urgent</span>
        <span className="urgent-strip__time">{formatIncidentClock(report.simTimeMs)}</span>
        <span className="urgent-strip__agent">{callsign ?? report.agentId}</span>
        <span className="urgent-strip__text">{report.text}</span>
      </div>
      {audio !== null ? <span className="urgent-strip__audio">{audio}</span> : null}
      {onInspectCrew ? (
        <button type="button" className="urgent-strip__inspect" onClick={() => onInspectCrew(report.agentId as string)}>
          Inspect {callsign ?? "crew"}
        </button>
      ) : null}
      {history.length > 0 ? (
        <details className="urgent-strip__history">
          <summary>Earlier urgent ({history.length})</summary>
          <ol>
            {history.map((entry) => (
              <li key={entry.sequence as number}>
                <span className="urgent-strip__time">{formatIncidentClock(entry.simTimeMs)}</span>{" "}
                <span className="urgent-strip__agent">{callsignFor(entry.agentId as string)}</span> {entry.text}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
