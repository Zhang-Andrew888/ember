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
  /** True when the audio indicator describes the timing stub rather than real playback. */
  readonly audioSimulated?: boolean;
  /** Real milliseconds since the last map snapshot arrived; null before the first one. */
  readonly snapshotAgeMs?: number | null;
}

/** A snapshot older than this is called out, so an open socket is never read as a fresh map. */
export const STALE_SNAPSHOT_MS = 5_000;

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Connected",
  closed: "Disconnected, reconnecting",
  error: "Connection error, reconnecting",
};

export function audioStatusLabel(snapshot: SpeechPlaybackSnapshot, simulated = false): string {
  const audio = simulated ? "Simulated audio" : "Audio";
  if (snapshot.state === "idle" && !snapshot.queuedUrgent && snapshot.queuedRoutineCount === 0) {
    return `${audio} idle`;
  }
  if (snapshot.queuedUrgent && snapshot.state === "idle") return `Urgent ${audio.toLowerCase()} queued`;
  if (snapshot.state === "pending") return `${audio} preparing`;
  if (snapshot.state === "playing") {
    return snapshot.urgent ? `Urgent ${audio.toLowerCase()} playing` : `Routine ${audio.toLowerCase()} playing`;
  }
  if (snapshot.queuedRoutineCount > 0) return `Routine ${audio.toLowerCase()} queued`;
  return `${audio} active`;
}

export function TopBar({
  transportMode,
  serverHealth = null,
  simTimeMs,
  wallElapsedMs,
  connectionStatus,
  speechSnapshot,
  audioSimulated = false,
  snapshotAgeMs = null,
}: TopBarProps) {
  const audioActive =
    speechSnapshot.state !== "idle" || speechSnapshot.queuedUrgent || speechSnapshot.queuedRoutineCount > 0;
  const stale = snapshotAgeMs !== null && snapshotAgeMs >= STALE_SNAPSHOT_MS;
  return (
    <header className="top-bar">
      <span className="top-bar__title">EMBER LINE</span>
      <TransportModeBadge mode={transportMode} />
      <span className="top-bar__remaining" aria-label="Remaining real time">
        {wallElapsedMs === null ? "5:00" : formatRemainingWallTime(wallElapsedMs)}
        <span className="top-bar__unit"> real time left</span>
      </span>
      <span className="top-bar__clock" aria-label="Simulated incident time">
        {simTimeMs === null ? "--:--" : formatIncidentClock(simTimeMs)}
        <span className="top-bar__unit"> incident time</span>
      </span>
      <span className={`top-bar__status top-bar__status--${connectionStatus}${stale ? " top-bar__status--stale" : ""}`}>
        <span role="status">{CONNECTION_LABEL[connectionStatus]}</span>
        {stale && snapshotAgeMs !== null ? <span className="top-bar__age"> · map {Math.floor(snapshotAgeMs / 1000)} s old</span> : null}
      </span>
      <span className={`top-bar__audio${audioActive ? " top-bar__audio--active" : ""}`}>
        {audioStatusLabel(speechSnapshot, audioSimulated)}
      </span>
      <details className="top-bar__details">
        <summary>Details</summary>
        <div className="top-bar__details-body">
          <p>
            Incident time runs {TIME_COMPRESSION}× faster than real time. The run ends after five real minutes.
          </p>
          {transportMode === "live" ? <GrokIntegrationBadge health={serverHealth ?? null} /> : null}
          {transportMode === "mock" ? (
            <p>
              Recorded showcase: the map updates only at recorded moments, so it can sit unchanged for a while. Messages
              get sample replies and do not change what the crews do.
            </p>
          ) : null}
          {audioSimulated ? <p>Audio status is simulated timing; no sound is played.</p> : null}
        </div>
      </details>
    </header>
  );
}
