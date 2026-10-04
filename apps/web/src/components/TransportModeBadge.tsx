import type { TransportMode } from "../net/transportMode.js";

export interface TransportModeBadgeProps {
  readonly mode: TransportMode;
  readonly briefing?: boolean;
}

/** What the coordinator is driving: always a simulation, either served live or replayed from a recording. */
export function transportModeLabel(mode: TransportMode): string {
  return mode === "live" ? "Simulation · live server" : "Recorded showcase · sample replies";
}

/** Always-visible live vs recorded mode so a stale mock dev server is obvious at a glance. */
export function TransportModeBadge({ mode, briefing = false }: TransportModeBadgeProps) {
  return (
    <span
      className={`transport-mode transport-mode--${mode}`}
      title={
        mode === "live"
          ? "A server runs this simulated incident and interprets your messages."
          : "A recorded incident plays back. Messages get sample replies and do not change what the crews do."
      }
      data-briefing={briefing || undefined}
    >
      {transportModeLabel(mode)}
    </span>
  );
}
