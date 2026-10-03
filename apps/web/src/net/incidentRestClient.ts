/**
 * Thin wrapper over the REST half of the browser/server transport contract
 * (docs/ARCHITECTURE.md: `POST /incidents/:id/start`). Best-effort: the
 * authoritative clock is server-owned, so a failed request just leaves the
 * incident un-started and surfaces through the connection status rather
 * than throwing into the render tree.
 */
export async function startIncident(baseUrl: string, incidentId: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/incidents/${encodeURIComponent(incidentId)}/start`, {
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}
