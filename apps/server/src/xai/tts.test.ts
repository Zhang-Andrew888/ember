import { describe, it, expect, vi, afterEach } from "vitest";
import { synthesizeSpeech } from "./tts.js";

describe("xai/tts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POSTs to xAI and returns audio bytes", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    const body = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => body.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await synthesizeSpeech({ text: "Hello" }, fetchMock as unknown as typeof fetch);
    expect(out).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.ai/v1/tts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
  });

  it("throws when the API key is missing", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    await expect(synthesizeSpeech({ text: "Hi" })).rejects.toThrow(/XAI_API_KEY/);
  });
});
