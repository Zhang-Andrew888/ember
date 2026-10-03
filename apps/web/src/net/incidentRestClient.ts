/**
 * Thin wrapper over the REST half of the browser/server transport contract
 * (docs/ARCHITECTURE.md: `POST /incidents`, `POST /incidents/:id/start`).
 * Best-effort: the authoritative clock is server-owned, so a failed request
 * just leaves the incident un-started and surfaces through the connection
 * status rather than throwing into the render tree.
 */

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
