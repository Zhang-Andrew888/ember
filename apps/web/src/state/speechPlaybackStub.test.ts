import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSpeechPlaybackStub } from "./speechPlaybackStub.js";

describe("state/speechPlaybackStub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle", () => {
    const stub = createSpeechPlaybackStub();
    expect(stub.getSnapshot()).toEqual({ state: "idle", text: null, urgent: false });
  });

  it("speak() moves pending -> playing -> idle with the same text throughout", () => {
    const stub = createSpeechPlaybackStub();
    stub.speak("Crew 1 on site.");

    expect(stub.getSnapshot().state).toBe("pending");
    expect(stub.getSnapshot().text).toBe("Crew 1 on site.");

    vi.advanceTimersByTime(200);
    expect(stub.getSnapshot().state).toBe("playing");
    expect(stub.getSnapshot().text).toBe("Crew 1 on site.");

    vi.advanceTimersByTime(10_000); // well past any possible playing duration
    expect(stub.getSnapshot()).toEqual({ state: "idle", text: null, urgent: false });
  });

  it("longer text plays for longer than the minimum duration", () => {
    const stub = createSpeechPlaybackStub();
    stub.speak("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen");
    vi.advanceTimersByTime(200 + 1200); // pending + the minimum playing duration a short message would use
    expect(stub.getSnapshot().state).toBe("playing"); // this one is long enough to still be going
  });

  it("very short text still plays for at least the minimum duration", () => {
    const stub = createSpeechPlaybackStub();
    stub.speak("hi");
    vi.advanceTimersByTime(200 + 1199);
    expect(stub.getSnapshot().state).toBe("playing");
    vi.advanceTimersByTime(1);
    expect(stub.getSnapshot().state).toBe("idle");
  });

  it("a routine speak() while something is already active is dropped, not queued", () => {
    const stub = createSpeechPlaybackStub();
    stub.speak("first message");
    vi.advanceTimersByTime(200); // now playing "first message"
    stub.speak("second message");
    expect(stub.getSnapshot().text).toBe("first message");
  });

  it("an urgent speak() interrupts whatever is currently playing", () => {
    const stub = createSpeechPlaybackStub();
    stub.speak("routine message");
    vi.advanceTimersByTime(200); // now playing "routine message"
    stub.speak("URGENT: fire crossing the road", { urgent: true });

    expect(stub.getSnapshot()).toEqual({ state: "pending", text: "URGENT: fire crossing the road", urgent: true });
  });

  it("an urgent speak() interrupts a pending (not yet playing) routine message too", () => {
    const stub = createSpeechPlaybackStub();
    stub.speak("routine message"); // still pending, hasn't reached playing yet
    stub.speak("urgent message", { urgent: true });
    expect(stub.getSnapshot().text).toBe("urgent message");
  });

  it("dispose() clears pending timers so a stale speak() never lands after unmount", () => {
    const stub = createSpeechPlaybackStub();
    const listener = vi.fn();
    stub.subscribe(listener);
    stub.speak("something");
    stub.dispose();
    listener.mockClear();

    vi.advanceTimersByTime(10_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies subscribers on every state transition", () => {
    const stub = createSpeechPlaybackStub();
    const listener = vi.fn();
    stub.subscribe(listener);

    stub.speak("hi");
    expect(listener).toHaveBeenCalledTimes(1); // -> pending

    vi.advanceTimersByTime(200);
    expect(listener).toHaveBeenCalledTimes(2); // -> playing

    vi.advanceTimersByTime(10_000);
    expect(listener).toHaveBeenCalledTimes(3); // -> idle
  });
});
