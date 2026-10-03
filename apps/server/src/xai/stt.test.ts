import { describe, it, expect, vi, afterEach } from "vitest";
import { transcribeAudio } from "./stt.js";

describe("xai/stt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POSTs multipart audio and returns text", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Crew 2, hold position." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio(new Uint8Array([9, 9]), { mimeType: "audio/webm" }, fetchMock as unknown as typeof fetch);
    expect(result.text).toBe("Crew 2, hold position.");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.x.ai/v1/stt");
  });
});
