import type { ServerHealthResponse } from "../net/serverHealth.js";
import { intentIntegrationLabel, intentIntegrationTitle } from "../net/serverHealth.js";

export interface GrokIntegrationBadgeProps {
  readonly health: ServerHealthResponse | null;
}

/** Live-server Grok intent/voice status from GET /health (no credentials). */
export function GrokIntegrationBadge({ health }: GrokIntegrationBadgeProps) {
  if (health === null) return null;
  return (
    <span
      className={`grok-integration grok-integration--${health.coordinatorIntent.mode}`}
      role="status"
      title={intentIntegrationTitle(health)}
    >
      {intentIntegrationLabel(health)}
    </span>
  );
}
