import { describe, expect, it, vi } from "vitest";
import { handleGrokAudioCue, PreparedSpeechPlayback, type PreparedSpeechAudio } from "./grokSpeechPlayback.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PreparedSpeechPlayback", () => {
  it("aborts an in-flight fetch and pauses audio when stop is called (PTT interrupt path)", async () => {
    const fetchDeferred = deferred<Response>();
    const audioDeferred = deferred<void>();
    let paused = false;
    const audio: PreparedSpeechAudio = {
      pause() {
        paused = true;
        audioDeferred.resolve(undefined);
      },
      onended: null,
      onerror: null,
      play: () => Promise.resolve(),
    };

    const createAudio = vi.fn(() => audio);
    const playback = new PreparedSpeechPlayback({
      fetch: vi.fn(() => fetchDeferred.promise),
      createAudio,
    });

    const playPromise = playback.play({ apiBase: "", incidentId: "inc", token: "tok", itemId: "routine" });
    fetchDeferred.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(["mp3"], { type: "audio/mpeg" })),
    } as Response);

    await vi.waitFor(() => expect(createAudio).toHaveBeenCalled());
    playback.stop("routine");
    await expect(playPromise).resolves.toBe("aborted");
    expect(paused).toBe(true);
    expect(playback.hasActive("routine")).toBe(false);
  });
});

describe("handleGrokAudioCue", () => {
  const ctx = {
    apiBase: "http://127.0.0.1:3000",
    incidentId: "inc-1",
    token: "secret",
    notifyFinished: vi.fn(),
  };

  it("stops routine playback when the server sends interrupted (push-to-talk)", async () => {
    const fetchDeferred = deferred<Response>();
    let paused = false;
    const audio: PreparedSpeechAudio = {
      pause() {
        paused = true;
      },
      onended: null,
      onerror: null,
      play: () => new Promise(() => undefined),
    };
    const createAudio = vi.fn(() => audio);
    const playback = new PreparedSpeechPlayback({
      fetch: vi.fn(() => fetchDeferred.promise),
      createAudio,
    });

    handleGrokAudioCue({ event: "started", itemId: "routine" }, playback, ctx);
    fetchDeferred.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(["x"], { type: "audio/mpeg" })),
    } as Response);
    await vi.waitFor(() => expect(createAudio).toHaveBeenCalled());

    handleGrokAudioCue({ event: "interrupted", itemId: "routine" }, playback, ctx);
    expect(paused).toBe(true);
    expect(playback.hasActive("routine")).toBe(false);
    expect(ctx.notifyFinished).not.toHaveBeenCalled();
  });

  it("plays urgent speech after routine is interrupted without sending audio_finished for the aborted line", async () => {
    ctx.notifyFinished.mockClear();

    const playback = new PreparedSpeechPlayback({
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        expect(url).toMatch(/\/speech\/(routine|urgent)$/);
        return {
          ok: true,
          blob: async () => new Blob(["x"], { type: "audio/mpeg" }),
        } as Response;
      }),
      createAudio: () => {
        const audio: PreparedSpeechAudio = {
          pause: vi.fn(),
          onended: null,
          onerror: null,
          play: () => {
            queueMicrotask(() => audio.onended?.());
            return Promise.resolve();
          },
        };
        return audio;
      },
    });

    handleGrokAudioCue({ event: "started", itemId: "routine" }, playback, ctx);
    await vi.waitFor(() => expect(playback.hasActive("routine")).toBe(true));

    handleGrokAudioCue({ event: "interrupted", itemId: "routine" }, playback, ctx);
    expect(playback.hasActive("routine")).toBe(false);

    handleGrokAudioCue({ event: "started", itemId: "urgent" }, playback, ctx);
    await vi.waitFor(() => expect(ctx.notifyFinished).toHaveBeenCalledWith("urgent"));
    expect(ctx.notifyFinished).not.toHaveBeenCalledWith("routine");
  });
});
