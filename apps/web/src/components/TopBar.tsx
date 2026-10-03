import type { ConnectionStatus } from "../net/CoordinatorViewClient.js";
import { formatIncidentClock, formatRemainingWallTime } from "../format/time.js";

export interface TopBarProps {
  readonly simTimeMs: number | null;
  readonly wallElapsedMs: number | null;
  readonly connectionStatus: ConnectionStatus;
}

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Connected",
  closed: "Disconnected — reconnecting",
  error: "Connection error — reconnecting",
};

export function TopBar({ simTimeMs, wallElapsedMs, connectionStatus }: TopBarProps) {
  return (
    <header className="top-bar">
      <span className="top-bar__title">EMBER LINE</span>
      <span className="top-bar__clock" aria-label="Incident clock">
        {simTimeMs === null ? "—:—" : formatIncidentClock(simTimeMs)}
      </span>
      <span className="top-bar__remaining" aria-label="Remaining real time">
        {wallElapsedMs === null ? "5:00 remaining" : `${formatRemainingWallTime(wallElapsedMs)} remaining`}
      </span>
      <span className={`top-bar__status top-bar__status--${connectionStatus}`} role="status">
        {CONNECTION_LABEL[connectionStatus]}
      </span>
    </header>
  );
}
