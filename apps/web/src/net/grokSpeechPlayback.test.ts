import { afterEach, describe, expect, it, vi } from "vitest";
import { applySpeechAudioCue, createPreparedSpeechPlayer, type PreparedSpeechPlayer } from "./grokSpeechPlayback.js";
import type { WireAudioCue } from "./serverWireParse.js";

class FakeAudio {
  src: string;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
  });
  readonly load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });

  constructor(src?: string) {
    this.src = src ?? "";
    audios.push(this);
  }
}

const audios: FakeAudio[] = [];
const SESSION = {
  apiBase: "http://localhost:3000",
  incidentId: "inc 1",
  token: "tok",
};

function cue(event: WireAudioCue["event"], itemId: string): WireAudioCue {
  return { type: "audio", event, itemId };
}

function speechResponse(): Response {
  return new Response(new Blob(["mp3"], { type: "audio/mpeg" }), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

function player(): PreparedSpeechPlayer {
  return createPreparedSpeechPlayer(SESSION);
}

async function untilPlaying(itemIndex: number): Promise<FakeAudio> {
  await vi.waitFor(() => {
    const audio = audios[itemIndex];
    expect(audio).toBeDefined();
    expect(audio?.play).toHaveBeenCalled();
  });
  const audio = audios[itemIndex];
  if (audio === undefined) throw new Error("audio missing");
  return audio;
}

describe("grok speech playback", () => {
  afterEach(() => {
    audios.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops a playing routine clip when push-to-talk interrupts it", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => speechResponse()),
    );

    const playback = player();
    applySpeechAudioCue(playback, cue("started", "routine"));
    const routine = await untilPlaying(0);
    expect(routine.paused).toBe(false);

    applySpeechAudioCue(playback, cue("interrupted", "routine"));

    expect(routine.pause).toHaveBeenCalledOnce();
    expect(routine.paused).toBe(true);
    expect(routine.src).toBe("");
    expect(revoke).toHaveBeenCalledOnce();

    applySpeechAudioCue(playback, cue("started", "routine"));
    const replayed = await untilPlaying(1);
    expect(replayed.paused).toBe(false);
    expect(routine.paused).toBe(true);
  });

  it("aborts an in-flight routine fetch when push-to-talk interrupts it", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        if (signal !== undefined && signal !== null) signals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );

    const playback = player();
    applySpeechAudioCue(playback, cue("started", "routine"));
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    applySpeechAudioCue(playback, cue("interrupted", "routine"));

    expect(signals[0]?.aborted).toBe(true);
    expect(audios).toHaveLength(0);
  });

  it("stops a playing routine clip when urgent speech preempts it", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/incidents/inc%201/speech/");
        return speechResponse();
      }),
    );

    const playback = player();
    applySpeechAudioCue(playback, cue("started", "routine"));
    const routine = await untilPlaying(0);

    applySpeechAudioCue(playback, cue("interrupted", "routine"));
    applySpeechAudioCue(playback, cue("started", "urgent"));
    const urgent = await untilPlaying(1);

    expect(routine.pause).toHaveBeenCalledOnce();
    expect(routine.paused).toBe(true);
    expect(urgent.paused).toBe(false);
    expect(urgent).not.toBe(routine);
  });

  it("stops a clip on dropped and on an incident-end interruption without blocking the end announcement", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => speechResponse()),
    );

    const playback = player();
    applySpeechAudioCue(playback, cue("started", "routine"));
    const routine = await untilPlaying(0);
    applySpeechAudioCue(playback, cue("started", "queued"));
    const queued = await untilPlaying(1);

    applySpeechAudioCue(playback, cue("interrupted", "routine"));
    applySpeechAudioCue(playback, cue("dropped", "queued"));
    applySpeechAudioCue(playback, cue("started", "end"));
    const ending = await untilPlaying(2);

    expect(routine.paused).toBe(true);
    expect(queued.pause).toHaveBeenCalledOnce();
    expect(queued.paused).toBe(true);
    expect(ending.paused).toBe(false);
  });
});
