import type { SpeechPlaybackOutcome } from "./wireProtocol.js";

export type PreparedSpeechOutcome = "completed" | "aborted" | "failed";

export interface PreparedSpeechPlayParams {
  readonly apiBase: string;
  readonly incidentId: string;
  readonly token: string;
  readonly itemId: string;
  /** Called once the browser has actually started the clip (not when the fetch begins). */
  readonly onPlaying?: () => void;
}

/** Minimal surface used for playback; injectable in tests. */
export interface PreparedSpeechAudio {
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
}

export interface PreparedSpeechDeps {
  readonly fetch: typeof fetch;
  readonly createAudio: (src: string) => PreparedSpeechAudio;
}

const defaultDeps: PreparedSpeechDeps = {
  fetch,
  createAudio: (src) => new Audio(src) as unknown as PreparedSpeechAudio,
};

interface ActivePlayback {
  readonly abort: AbortController;
  audio: PreparedSpeechAudio | null;
  objectUrl: string | null;
}

/**
 * Tracks in-flight TTS fetch/play by item id so `interrupted` / `dropped` cues and incident end
 * can stop browser audio (#75). Acknowledgements use `speech_playback` on the events socket (#85).
 */
export class PreparedSpeechPlayback {
  private readonly active = new Map<string, ActivePlayback>();

  constructor(private readonly deps: PreparedSpeechDeps = defaultDeps) {}

  async play(params: PreparedSpeechPlayParams): Promise<PreparedSpeechOutcome> {
    const { apiBase, incidentId, token, itemId } = params;
    this.stop(itemId);

    const abort = new AbortController();
    const slot: ActivePlayback = { abort, audio: null, objectUrl: null };
    this.active.set(itemId, slot);

    const base = apiBase === "" ? "" : apiBase.replace(/\/$/, "");
    const url = `${base}/incidents/${encodeURIComponent(incidentId)}/speech/${encodeURIComponent(itemId)}`;

    try {
      const response = await this.deps.fetch(url, {
        headers: { "x-incident-token": token },
        signal: abort.signal,
      });
      if (abort.signal.aborted) return "aborted";
      if (!response.ok) return "failed";

      const blob = await response.blob();
      if (abort.signal.aborted) return "aborted";

      const objectUrl = URL.createObjectURL(blob);
      slot.objectUrl = objectUrl;
      const audio = this.deps.createAudio(objectUrl);
      slot.audio = audio;

      await new Promise<void>((resolve, reject) => {
        const settle = (fn: () => void): void => {
          abort.signal.removeEventListener("abort", onAbort);
          fn();
        };
        const onAbort = (): void => {
          audio.pause();
          settle(() => reject(new DOMException("Aborted", "AbortError")));
        };
        abort.signal.addEventListener("abort", onAbort);
        audio.onended = () => settle(resolve);
        audio.onerror = () => settle(() => reject(new Error("playback failed")));
        void audio
          .play()
          .then(() => {
            if (!abort.signal.aborted) params.onPlaying?.();
          })
          .catch((err) => settle(() => reject(err instanceof Error ? err : new Error("playback failed"))));
      });
      return "completed";
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return "aborted";
      return "failed";
    } finally {
      this.releaseSlot(itemId, slot);
    }
  }

  /** Stop fetch and playback for one prepared item (server `interrupted` / `dropped`). */
  stop(itemId: string): void {
    const slot = this.active.get(itemId);
    if (slot === undefined) return;
    slot.abort.abort();
    slot.audio?.pause();
    this.releaseSlot(itemId, slot);
  }

  stopAll(): void {
    for (const itemId of [...this.active.keys()]) this.stop(itemId);
  }

  /** @internal test hook */
  hasActive(itemId: string): boolean {
    return this.active.has(itemId);
  }

  private releaseSlot(itemId: string, slot: ActivePlayback): void {
    if (this.active.get(itemId) !== slot) return;
    if (slot.objectUrl !== null) URL.revokeObjectURL(slot.objectUrl);
    slot.audio?.pause();
    this.active.delete(itemId);
  }
}

/** Maps browser playback result to the server wire outcome; `aborted` sends nothing. */
export function preparedOutcomeToSpeechPlayback(outcome: PreparedSpeechOutcome): SpeechPlaybackOutcome | null {
  if (outcome === "completed") return "ended";
  if (outcome === "failed") return "failed";
  return null;
}

/** Fetch server-prepared xAI TTS (MP3) and play in the browser. */
export async function playPreparedSpeech(
  apiBase: string,
  incidentId: string,
  token: string,
  itemId: string,
  playback: PreparedSpeechPlayback = sharedPreparedSpeechPlayback,
): Promise<PreparedSpeechOutcome> {
  return playback.play({ apiBase, incidentId, token, itemId });
}

export const sharedPreparedSpeechPlayback = new PreparedSpeechPlayback();

export interface GrokAudioCueContext {
  readonly apiBase: string;
  readonly incidentId: string;
  readonly token: string;
  readonly notifyPlayback: (itemId: string, outcome: SpeechPlaybackOutcome) => void;
  /** Local playback progress for on-screen audio status. */
  readonly onPlaying?: (itemId: string) => void;
  readonly onOutcome?: (itemId: string, outcome: PreparedSpeechOutcome) => void;
}

/** Maps server audio wire cues to browser playback (#75) and `speech_playback` acks (#85). */
export function handleGrokAudioCue(
  cue: { readonly event: string; readonly itemId: string },
  playback: PreparedSpeechPlayback,
  ctx: GrokAudioCueContext,
): void {
  switch (cue.event) {
    case "started":
      void playback
        .play({
          apiBase: ctx.apiBase,
          incidentId: ctx.incidentId,
          token: ctx.token,
          itemId: cue.itemId,
          onPlaying: () => ctx.onPlaying?.(cue.itemId),
        })
        .then((outcome: PreparedSpeechOutcome) => {
          ctx.onOutcome?.(cue.itemId, outcome);
          const wire = preparedOutcomeToSpeechPlayback(outcome);
          if (wire !== null) ctx.notifyPlayback(cue.itemId, wire);
        });
      return;
    case "interrupted":
    case "dropped":
      playback.stop(cue.itemId);
      return;
    default:
      return;
  }
}
