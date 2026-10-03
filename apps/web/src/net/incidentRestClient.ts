/**
 * Thin wrapper over the REST half of the browser/server transport contract
 * (docs/ARCHITECTURE.md: `POST /incidents`, `POST /incidents/:id/start`,
 * `GET /incidents/:id/replay`).
 * Best-effort: the authoritative clock is server-owned, so a failed request
 * just leaves the incident un-started and surfaces through the connection
 * status rather than throwing into the render tree.
 */

import { ReplayRecording, type ReplayRecording as IncidentReplayRecording } from "../replay/recording.js";

export type { IncidentReplayRecording };

export interface CreatedIncident {
  readonly incidentId: string;
  readonly token: string;
  /** Path or absolute URL for the events WebSocket (includes token query). */
  readonly websocketEventsPath: string;
}

function restUrl(baseUrl: string, path: string): string {
  if (baseUrl === "") return path;
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Resolve server `websocket.events` to a URL the browser can open. */
export function resolveWebSocketUrl(apiBase: string, eventsPath: string): string {
  if (eventsPath.startsWith("ws://") || eventsPath.startsWith("wss://")) {
    return eventsPath;
  }
  if (apiBase !== "") {
    const http = new URL(apiBase);
    const wsProto = http.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${http.host}${eventsPath}`;
  }
  if (typeof window !== "undefined") {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${window.location.host}${eventsPath}`;
  }
  return eventsPath;
}

export async function createIncident(baseUrl: string): Promise<CreatedIncident | null> {
  try {
    const response = await fetch(restUrl(baseUrl, "/incidents"), { method: "POST" });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      incidentId?: string;
      token?: string;
      websocket?: { events?: string };
    };
    const events = data.websocket?.events;
    if (data.incidentId === undefined || data.token === undefined || events === undefined) {
      return null;
    }
    return {
      incidentId: data.incidentId,
      token: data.token,
      websocketEventsPath: events,
    };
  } catch {
    return null;
  }
}

export async function startIncident(
  baseUrl: string,
  incidentId: string,
  token?: string,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers["x-incident-token"] = token;
    const response = await fetch(restUrl(baseUrl, `/incidents/${encodeURIComponent(incidentId)}/start`), {
      method: "POST",
      headers,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type FetchIncidentReplayResult =
  | { readonly status: "ok"; readonly recording: IncidentReplayRecording }
  | { readonly status: "active" }
  | { readonly status: "error" };

/** Finished-run replay export (coordinator log + truth frames). Ignores server `end` metadata. */
export async function fetchIncidentReplay(
  baseUrl: string,
  incidentId: string,
  token: string,
): Promise<FetchIncidentReplayResult> {
  try {
    const response = await fetch(restUrl(baseUrl, `/incidents/${encodeURIComponent(incidentId)}/replay`), {
      headers: { "x-incident-token": token },
    });
    if (response.status === 409) return { status: "active" };
    if (!response.ok) return { status: "error" };
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) return { status: "error" };
    const body = data as { coordinatorLog?: unknown; truthFrames?: unknown };
    const parsed = ReplayRecording.safeParse({
      coordinatorLog: body.coordinatorLog,
      truthFrames: body.truthFrames,
    });
    if (!parsed.success) return { status: "error" };
    return { status: "ok", recording: parsed.data };
  } catch {
    return { status: "error" };
  }
}
