import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createIncident,
  fetchIncidentReplay,
  resolveWebSocketUrl,
  startIncident,
} from "./incidentRestClient.js";
import { mockRecording } from "../replay/mockRecording.js";

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
      headers: {},
    });
  });

  it("sends x-incident-token when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await startIncident("http://localhost:3000", "incident-1", "secret-token");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/incidents/incident-1/start", {
      method: "POST",
      headers: { "x-incident-token": "secret-token" },
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
      { method: "POST", headers: {} },
    );
  });
});

describe("net/incidentRestClient - createIncident", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST /incidents and returns id, token, and events path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          incidentId: "abc",
          token: "tok",
          websocket: { events: "/incidents/abc/events" },
        }),
      }),
    );

    const created = await createIncident("http://localhost:3000");
    expect(created).toEqual({
      incidentId: "abc",
      token: "tok",
      websocketEventsPath: "/incidents/abc/events",
    });
  });

  it("returns null on failed response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await createIncident("http://localhost:3000")).toBeNull();
  });
});

describe("net/incidentRestClient - fetchIncidentReplay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses coordinator log and truth frames on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          coordinatorLog: mockRecording.coordinatorLog,
          truthFrames: mockRecording.truthFrames,
          end: { tick: 1, displayReason: "time", matchingReasons: ["time"] },
        }),
      }),
    );

    const result = await fetchIncidentReplay("http://localhost:3000", "inc-1", "tok");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.recording.coordinatorLog.length).toBe(mockRecording.coordinatorLog.length);
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://localhost:3000/incidents/inc-1/replay", {
      headers: { "x-incident-token": "tok" },
    });
  });

  it("returns active when the server responds 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    expect(await fetchIncidentReplay("http://localhost:3000", "x", "t")).toEqual({ status: "active" });
  });

  it("returns error on invalid payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ coordinatorLog: [], truthFrames: [] }) }),
    );
    expect(await fetchIncidentReplay("http://localhost:3000", "x", "t")).toEqual({ status: "error" });
  });
});

describe("net/incidentRestClient - resolveWebSocketUrl", () => {
  it("maps http base to ws on the same host", () => {
    expect(resolveWebSocketUrl("http://127.0.0.1:3000", "/incidents/x/events")).toBe(
      "ws://127.0.0.1:3000/incidents/x/events",
    );
  });

  it("passes through absolute ws URLs", () => {
    expect(resolveWebSocketUrl("", "ws://127.0.0.1:1/events")).toBe("ws://127.0.0.1:1/events");
  });
});
