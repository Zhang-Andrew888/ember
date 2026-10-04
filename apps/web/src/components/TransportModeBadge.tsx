import type { TransportMode } from "../net/transportMode.js";

export interface TransportModeBadgeProps {
  readonly mode: TransportMode;
  readonly briefing?: boolean;
}

/** Always-visible LIVE vs MOCK so a stale mock dev server is obvious at a glance. */
export function TransportModeBadge({ mode, briefing = false }: TransportModeBadgeProps) {
  const label = briefing ? (mode === "live" ? "Live connection" : "Demo data") : (mode === "live" ? "LIVE" : "MOCK");
  return (
    <span
      className={`transport-mode transport-mode--${mode}`}
      role="status"
      aria-label={briefing ? undefined : mode === "live" ? "Live server transport" : "In-browser mock transport"}
    >
      {label}
    </span>
  );
}
