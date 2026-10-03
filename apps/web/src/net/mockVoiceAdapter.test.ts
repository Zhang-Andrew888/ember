import { describe, it, expect } from "vitest";
import { createMockVoiceAdapter } from "./mockVoiceAdapter.js";

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("net/mockVoiceAdapter", () => {
  it("starts idle", () => {
    const adapter = createMockVoiceAdapter();
    expect(adapter.state).toBe("idle");
  });

  it("start() moves to recording", () => {
    const adapter = createMockVoiceAdapter();
    adapter.start();
    expect(adapter.state).toBe("recording");
  });

  it("start() is idempotent while already recording", () => {
    const clock = fakeClock();
    const adapter = createMockVoiceAdapter({ now: clock.now });
    adapter.start();
    clock.advance(50);
    adapter.start(); // should not reset the hold timer
    clock.advance(200);
    const result = adapter.commit();
    expect(result).not.toBeNull(); // 250ms held overall, well past minHoldMs
  });

  it("commit() returns null when not recording", () => {
    const adapter = createMockVoiceAdapter();
    expect(adapter.commit()).toBeNull();
  });

  it("commit() returns null for a too-brief hold (accidental tap)", () => {
    const clock = fakeClock();
    const adapter = createMockVoiceAdapter({ now: clock.now, minHoldMs: 150 });
    adapter.start();
    clock.advance(50);
    expect(adapter.commit()).toBeNull();
    expect(adapter.state).toBe("idle");
  });

  it("commit() returns a transcript for a held-long-enough capture, then returns to idle", () => {
    const clock = fakeClock();
    const adapter = createMockVoiceAdapter({ now: clock.now, minHoldMs: 150 });
    adapter.start();
    clock.advance(300);
    const result = adapter.commit();
    expect(result?.text.length).toBeGreaterThan(0);
    expect(adapter.state).toBe("idle");
  });

  it("cycles through transcripts across multiple commits, never empty", () => {
    const clock = fakeClock();
    const adapter = createMockVoiceAdapter({ now: clock.now, minHoldMs: 0, transcripts: ["a", "b"] });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      adapter.start();
      clock.advance(10);
      seen.push(adapter.commit()!.text);
    }
    expect(seen).toEqual(["a", "b", "a", "b"]);
  });

  it("cancel() safely ends capture without producing a transcript", () => {
    const adapter = createMockVoiceAdapter();
    adapter.start();
    adapter.cancel();
    expect(adapter.state).toBe("idle");
    expect(adapter.commit()).toBeNull();
  });

  it("cancel() is safe to call when already idle", () => {
    const adapter = createMockVoiceAdapter();
    expect(() => adapter.cancel()).not.toThrow();
    expect(adapter.state).toBe("idle");
  });
});
