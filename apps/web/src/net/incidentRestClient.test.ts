import { describe, it, expect, vi, afterEach } from "vitest";
import { startIncident } from "./incidentRestClient.js";

describe("net/incidentRestClient - startIncident", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /incidents/:id/start and returns true on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await startIncident("http://localhost:3000", "incident-1");

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/incidents/incident-1/start", {
      method: "POST",
    });
  });

  it("returns false when the server responds with a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await startIncident("http://localhost:3000", "incident-1")).toBe(false);
  });

  it("returns false instead of throwing when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await startIncident("http://localhost:3000", "incident-1")).toBe(false);
  });

  it("encodes the incident id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await startIncident("http://localhost:3000", "incident with spaces");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/incidents/incident%20with%20spaces/start",
      { method: "POST" },
    );
  });
});
