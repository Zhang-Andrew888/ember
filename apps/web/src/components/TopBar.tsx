import type { ConnectionStatus } from "../net/CoordinatorViewClient.js";
import type { TransportMode } from "../net/transportMode.js";
import type { SpeechPlaybackSnapshot } from "../state/speechPlaybackStub.js";
import { TIME_COMPRESSION, formatIncidentClock, formatRemainingWallTime } from "../format/time.js";
import { TransportModeBadge } from "./TransportModeBadge.js";
import { GrokIntegrationBadge } from "./GrokIntegrationBadge.js";
import type { ServerHealthResponse } from "../net/serverHealth.js";

export interface TopBarProps {
  readonly transportMode: TransportMode;
  readonly serverHealth?: ServerHealthResponse | null;
  readonly simTimeMs: number | null;
  readonly wallElapsedMs: number | null;
  readonly connectionStatus: ConnectionStatus;
  readonly speechSnapshot: SpeechPlaybackSnapshot;
}

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Connected",
  closed: "Disconnected, reconnecting",
  error: "Connection error, reconnecting",
};

function audioStatusLabel(snapshot: SpeechPlaybackSnapshot): string {
  if (snapshot.state === "idle" && !snapshot.queuedUrgent && snapshot.queuedRoutineCount === 0) {
    return "Audio idle";
  }
  if (snapshot.queuedUrgent && snapshot.state === "idle") return "Urgent audio queued";
  if (snapshot.state === "pending") return "Audio preparing";
  if (snapshot.state === "playing") return snapshot.urgent ? "Urgent audio playing" : "Routine audio playing";
  if (snapshot.queuedRoutineCount > 0) return "Routine audio queued";
  return "Audio active";
}

export function TopBar({ transportMode, serverHealth = null, simTimeMs, wallElapsedMs, connectionStatus, speechSnapshot }: TopBarProps) {
  return (
    <header className="top-bar">
      <span className="top-bar__title">EMBER LINE</span>
      <TransportModeBadge mode={transportMode} />
      {transportMode === "live" ? <GrokIntegrationBadge health={serverHealth ?? null} /> : null}
      <span
        className="top-bar__clock"
        aria-label="Simulated incident time"
        title={`Incident time runs ${TIME_COMPRESSION}x faster than the clock on the wall`}
      >
        {simTimeMs === null ? "--:--" : formatIncidentClock(simTimeMs)} simulated
      </span>
      <span className="top-bar__remaining" aria-label="Remaining real time">
        {wallElapsedMs === null ? "5:00 real time left" : `${formatRemainingWallTime(wallElapsedMs)} real time left`}
      </span>
      <span className="top-bar__compression">Incident time runs {TIME_COMPRESSION}× faster than real time</span>
      <span className={`top-bar__status top-bar__status--${connectionStatus}`} role="status">
        {CONNECTION_LABEL[connectionStatus]}
      </span>
      <span className="top-bar__audio" role="status">
        {audioStatusLabel(speechSnapshot)}
      </span>
    </header>
  );
}
