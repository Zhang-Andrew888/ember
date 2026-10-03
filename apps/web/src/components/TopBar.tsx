import type { ConnectionStatus } from "../net/CoordinatorViewClient.js";
import type { TransportMode } from "../net/transportMode.js";
import type { SpeechPlaybackSnapshot } from "../state/speechPlaybackStub.js";
import { formatIncidentClock, formatRemainingWallTime } from "../format/time.js";
import { TransportModeBadge } from "./TransportModeBadge.js";

export interface TopBarProps {
  readonly transportMode: TransportMode;
  readonly simTimeMs: number | null;
  readonly wallElapsedMs: number | null;
  readonly connectionStatus: ConnectionStatus;
  readonly speechSnapshot: SpeechPlaybackSnapshot;
}

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Connected",
  closed: "Disconnected — reconnecting",
  error: "Connection error — reconnecting",
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

export function TopBar({ transportMode, simTimeMs, wallElapsedMs, connectionStatus, speechSnapshot }: TopBarProps) {
  return (
    <header className="top-bar">
      <span className="top-bar__title">EMBER LINE</span>
      <TransportModeBadge mode={transportMode} />
      <span className="top-bar__clock" aria-label="Incident clock">
        {simTimeMs === null ? "—:—" : formatIncidentClock(simTimeMs)}
      </span>
      <span className="top-bar__remaining" aria-label="Remaining real time">
        {wallElapsedMs === null ? "5:00 remaining" : `${formatRemainingWallTime(wallElapsedMs)} remaining`}
      </span>
      <span className={`top-bar__status top-bar__status--${connectionStatus}`} role="status">
        {CONNECTION_LABEL[connectionStatus]}
      </span>
      <span className="top-bar__audio" role="status">
        {audioStatusLabel(speechSnapshot)}
      </span>
    </header>
  );
}
