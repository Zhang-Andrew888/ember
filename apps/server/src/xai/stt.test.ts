import { describe, it, expect, vi, afterEach } from "vitest";
import { INTERPRETATION_DEADLINE_MS } from "@ember/communication";
import { transcribeAudio } from "./stt.js";

describe("xai/stt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a never-resolving transcription at the interpretation deadline", async () => {
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
    const pending = transcribeAudio(new Uint8Array([1]), {}, fetchMock as unknown as typeof fetch);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(deadline.signal);
    deadline.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
