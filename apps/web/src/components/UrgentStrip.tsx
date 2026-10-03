import type { CoordinatorReportEntry } from "@ember/domain";
import { formatIncidentClock } from "../format/time.js";

export interface UrgentStripProps {
  readonly report: CoordinatorReportEntry | null;
  readonly callsign: string | null;
  readonly audioState: "idle" | "pending" | "playing";
  readonly queuedUrgent: boolean;
}

/**
 * Persistent urgent strip above the composer (docs/FRONTEND.md). An
 * accessible alert region so urgent reports are announced once per event
 * regardless of where focus currently is - never conveyed by color alone.
 */
export function UrgentStrip({ report, callsign, audioState, queuedUrgent }: UrgentStripProps) {
  if (!report) {
    return (
      <div className="urgent-strip urgent-strip--empty" role="status">
        No urgent reports.
      </div>
    );
  }

  return (
    <div className="urgent-strip urgent-strip--active" role="alert">
      <span className="urgent-strip__time">{formatIncidentClock(report.simTimeMs)}</span>
      <span className="urgent-strip__agent">{callsign ?? report.agentId}</span>
      <span className="urgent-strip__text">{report.text}</span>
      {audioState !== "idle" || queuedUrgent ? (
        <span className="urgent-strip__audio">
          {queuedUrgent && audioState === "idle"
            ? "audio next"
            : audioState === "pending"
              ? "audio next"
              : audioState === "playing"
                ? "playing"
                : ""}
        </span>
      ) : null}
    </div>
  );
}
