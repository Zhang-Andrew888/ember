import type { WireAudioCue } from "./serverWireParse.js";

/** Browser playback of one server-prepared TTS clip, stoppable by item id. */
export interface PreparedSpeechPlayer {
  play(itemId: string): void;
  /** Pause the clip, release its object URL, and abort an in-flight fetch. */
  stop(itemId: string): void;
  stopAll(): void;
}

export interface PreparedSpeechPlayerOptions {
  readonly apiBase: string;
  readonly incidentId: string;
  readonly token: string;
}

interface PlaybackSlot {
  readonly abort: AbortController;
  audio: HTMLAudioElement | null;
  objectUrl: string | null;
  released: boolean;
}

function speechUrl(apiBase: string, incidentId: string, itemId: string): string {
  const base = apiBase === "" ? "" : apiBase.replace(/\/$/, "");
  return `${base}/incidents/${encodeURIComponent(incidentId)}/speech/${encodeURIComponent(itemId)}`;
}

function releaseElement(audio: HTMLAudioElement): void {
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/**
 * Plays server-prepared MP3 clips in the browser.
 * Each item id keeps its Audio element and fetch so an `interrupted` or `dropped`
 * cue can stop that clip without touching a later one.
 */
export function createPreparedSpeechPlayer(options: PreparedSpeechPlayerOptions): PreparedSpeechPlayer {
  const slots = new Map<string, PlaybackSlot>();

  function release(itemId: string, slot: PlaybackSlot): void {
    if (slot.released) return;
    slot.released = true;
    slot.abort.abort();
    const audio = slot.audio;
    slot.audio = null;
    if (audio !== null) releaseElement(audio);
    const objectUrl = slot.objectUrl;
    slot.objectUrl = null;
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    if (slots.get(itemId) === slot) slots.delete(itemId);
  }

  async function run(itemId: string, slot: PlaybackSlot): Promise<void> {
    try {
      const response = await fetch(speechUrl(options.apiBase, options.incidentId, itemId), {
        headers: { "x-incident-token": options.token },
        signal: slot.abort.signal,
      });
      if (slot.released) return;
      if (!response.ok) {
        release(itemId, slot);
        return;
      }
      const blob = await response.blob();
      if (slot.released) return;
      const objectUrl = URL.createObjectURL(blob);
      slot.objectUrl = objectUrl;
      const audio = new Audio(objectUrl);
      slot.audio = audio;
      audio.onended = () => release(itemId, slot);
      audio.onerror = () => release(itemId, slot);
      await audio.play();
    } catch {
      if (!slot.released) release(itemId, slot);
    }
  }

  function play(itemId: string): void {
    const previous = slots.get(itemId);
    if (previous !== undefined) release(itemId, previous);
    const slot: PlaybackSlot = {
      abort: new AbortController(),
      audio: null,
      objectUrl: null,
      released: false,
    };
    slots.set(itemId, slot);
    void run(itemId, slot);
  }

  function stop(itemId: string): void {
    const slot = slots.get(itemId);
    if (slot !== undefined) release(itemId, slot);
  }

  function stopAll(): void {
    for (const itemId of [...slots.keys()]) stop(itemId);
  }

  return { play, stop, stopAll };
}

/** `started` begins playback. `interrupted` and `dropped` stop that item, including incident end. */
export function applySpeechAudioCue(player: PreparedSpeechPlayer, cue: WireAudioCue): void {
  if (cue.event === "started") {
    player.play(cue.itemId);
    return;
  }
  if (cue.event === "interrupted" || cue.event === "dropped") {
    player.stop(cue.itemId);
  }
}
