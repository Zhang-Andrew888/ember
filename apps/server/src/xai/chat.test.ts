import { describe, it, expect, vi, afterEach } from "vitest";
import type { InterpretationRequest } from "@ember/communication";
import { completeIntentInterpretation } from "./chat.js";

const sampleReq: InterpretationRequest = {
  commandId: "cmd-1",
  inputSequence: 0,
  text: "Crew 1, hold position",
  activeRecipientCallsign: null,
  directory: {
    agents: [{ id: "crew-1", callsign: "Crew 1", role: "protection_crew" }],
    sites: [],
    scoutPoints: [],
    locations: [],
    corridors: [],
  },
};

describe("xai/chat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POSTs chat completions and returns assistant content", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"kind":"objective","objective":{"kind":"hold"}}' } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await completeIntentInterpretation(sampleReq, fetchMock as unknown as typeof fetch);
    expect(out).toContain("hold");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.ai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string; messages: unknown[] };
    expect(body.messages).toHaveLength(2);
    expect(body.model).toBeTruthy();
  });

  it("throws when the API key is missing", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    await expect(completeIntentInterpretation(sampleReq)).rejects.toThrow(/XAI_API_KEY/);
  });
});
