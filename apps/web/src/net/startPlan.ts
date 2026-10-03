/**
 * How the app obtains its incident when Start is pressed. Mirrors .env.example:
 * - nothing set                      -> mock demo
 * - REST base only                   -> POST /incidents, then use the returned WebSocket
 * - WebSocket URL set (+ id/token)   -> PRE-CONFIGURED: do NOT create an incident
 *   (".env.example": "Pre-configured WebSocket URL (skips POST /incidents create)"); the
 *   REST base, if also set, is only used to POST /incidents/:id/start.
 */
export type StartPlan =
  | { readonly kind: "mock" }
  | { readonly kind: "create-incident" }
  | { readonly kind: "preconfigured" };

export function planStart(env: { readonly wsUrl: string | undefined; readonly restBase: string | undefined }): StartPlan {
  const hasWs = env.wsUrl !== undefined && env.wsUrl !== "";
  if (hasWs) return { kind: "preconfigured" };
  if (env.restBase !== undefined) return { kind: "create-incident" };
  return { kind: "mock" };
}

export const START_FAILED_MESSAGE =
  "Could not create the incident. Check that the server is running and reachable, then try again.";
