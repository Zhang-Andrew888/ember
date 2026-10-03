import type { ConnectionStatus } from "../net/CoordinatorViewClient.js";

export interface ConnectionBannerProps {
  readonly status: ConnectionStatus;
}

const MESSAGE: Record<Exclude<ConnectionStatus, "open">, string> = {
  connecting: "Connecting to incident channel…",
  closed: "Connection lost. Reconnecting. Messages are paused until the channel is back.",
  error: "Connection error. Retrying. Messages are paused until the channel is back.",
};

/** Visible disconnect / reconnect state (feat/web-ui); complements the top-bar status line. */
export function ConnectionBanner({ status }: ConnectionBannerProps) {
  if (status === "open") return null;
  return (
    <div className={`connection-banner connection-banner--${status}`} role="status">
      {MESSAGE[status]}
    </div>
  );
}
