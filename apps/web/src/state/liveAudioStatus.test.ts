import { describe, expect, it } from "vitest";
import {
  AUDIO_PLAYBACK_FAILED_NOTICE,
  AUDIO_UNAVAILABLE_NOTICE,
  INITIAL_LIVE_AUDIO,
  liveAudioReducer,
  liveAudioSnapshot,
  type LiveAudioEvent,
} from "./liveAudioStatus.js";

function run(events: readonly LiveAudioEvent[]) {
  return events.reduce(liveAudioReducer, INITIAL_LIVE_AUDIO);
}

describe("liveAudioReducer", () => {
  it("is pending until the browser actually starts playback", () => {
    const pending = run([{ kind: "cue", cue: { event: "started", itemId: "a" } }]);
    expect(pending.state).toBe("pending");
    const playing = liveAudioReducer(pending, { kind: "playing", itemId: "a" });
    expect(playing.state).toBe("playing");
    expect(liveAudioSnapshot(playing).state).toBe("playing");
  });

  it("returns to idle when the current item finishes", () => {
    const done = run([
      { kind: "cue", cue: { event: "started", itemId: "a" } },
      { kind: "playing", itemId: "a" },
      { kind: "outcome", itemId: "a", outcome: "completed" },
    ]);
    expect(done.state).toBe("idle");
    expect(done.notice).toBeNull();
  });

  it("marks urgent items announced by alert and reports them queued until they start", () => {
    const queued = run([
      { kind: "cue", cue: { event: "started", itemId: "routine" } },
      { kind: "cue", cue: { event: "alert", itemId: "urgent" } },
    ]);
    expect(liveAudioSnapshot(queued).queuedUrgent).toBe(true);
    const started = run([
      { kind: "cue", cue: { event: "alert", itemId: "urgent" } },
      { kind: "cue", cue: { event: "started", itemId: "urgent" } },
      { kind: "playing", itemId: "urgent" },
    ]);
    expect(started.urgent).toBe(true);
    expect(liveAudioSnapshot(started).queuedUrgent).toBe(false);
  });

  it("surfaces unavailable audio and playback failure as notices", () => {
    expect(run([{ kind: "cue", cue: { event: "audio_unavailable", itemId: "a" } }]).notice).toBe(AUDIO_UNAVAILABLE_NOTICE);
    const failed = run([
      { kind: "cue", cue: { event: "started", itemId: "a" } },
      { kind: "outcome", itemId: "a", outcome: "failed" },
    ]);
    expect(failed.notice).toBe(AUDIO_PLAYBACK_FAILED_NOTICE);
    expect(liveAudioReducer(failed, { kind: "dismiss_notice" }).notice).toBeNull();
  });

  it("stop clears playback but keeps an unread notice", () => {
    const stopped = run([
      { kind: "cue", cue: { event: "audio_unavailable", itemId: "a" } },
      { kind: "cue", cue: { event: "started", itemId: "b" } },
      { kind: "stop" },
    ]);
    expect(stopped.state).toBe("idle");
    expect(stopped.notice).toBe(AUDIO_UNAVAILABLE_NOTICE);
  });

  it("ignores an outcome for an item that is not current", () => {
    const status = run([
      { kind: "cue", cue: { event: "started", itemId: "b" } },
      { kind: "playing", itemId: "b" },
      { kind: "outcome", itemId: "a", outcome: "completed" },
    ]);
    expect(status.state).toBe("playing");
    expect(status.currentItemId).toBe("b");
  });
});
