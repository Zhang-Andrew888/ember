import { describe, it, expect, vi, afterEach } from "vitest";
import { INTERPRETATION_DEADLINE_MS } from "@ember/communication";
import { synthesizeSpeech } from "./tts.js";

describe("xai/tts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("aborts a never-resolving synthesis at the interpretation deadline", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      expect(ms).toBe(INTERPRETATION_DEADLINE_MS);
      return deadline.signal;
    });
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    const pending = synthesizeSpeech({ text: "Hello" }, fetchMock as unknown as typeof fetch);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(deadline.signal);
    deadline.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });

  it("throws when the API key is missing", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    await expect(synthesizeSpeech({ text: "Hi" })).rejects.toThrow(/XAI_API_KEY/);
  });
});
