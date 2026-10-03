import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { createMockIncidentSocket, authoredSnapshots } from "./mockIncidentSocket.js";

describe("net/mockIncidentSocket - authoredSnapshots", () => {
  it("is a non-empty, schema-valid, sequence-ordered script", () => {
    expect(authoredSnapshots.length).toBeGreaterThan(1);
    for (const snapshot of authoredSnapshots) {
      expect(() => CoordinatorView.parse(snapshot)).not.toThrow();
    }
    const sequences = authoredSnapshots.map((s) => s.sequence as number);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });
});

describe("net/mockIncidentSocket - createMockIncidentSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens asynchronously without emitting any snapshot on its own", () => {
    const socket = createMockIncidentSocket({ intervalMs: 100 });
    const onopen = vi.fn();
    const onmessage = vi.fn();
    socket.onopen = onopen;
    socket.onmessage = onmessage;

    expect(socket.readyState).toBe(0);
    vi.advanceTimersByTime(0);
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(1);

    vi.advanceTimersByTime(10_000);
    expect(onmessage).not.toHaveBeenCalled();
  });

  it("emits every snapshot in order after start()", () => {
    const socket = createMockIncidentSocket({ intervalMs: 100 });
    const received: unknown[] = [];
    socket.onmessage = (event) => received.push(JSON.parse(event.data));

    vi.advanceTimersByTime(0);
    socket.start();
    vi.advanceTimersByTime(100 * authoredSnapshots.length);

    expect(received).toHaveLength(authoredSnapshots.length);
    expect((received[0] as { sequence: number }).sequence).toBe(authoredSnapshots[0]!.sequence);
  });

  it("start() is idempotent", () => {
    const socket = createMockIncidentSocket({ intervalMs: 100 });
    const onmessage = vi.fn();
    socket.onmessage = onmessage;

    vi.advanceTimersByTime(0);
    socket.start();
    socket.start();
    vi.advanceTimersByTime(100 * authoredSnapshots.length);

    expect(onmessage).toHaveBeenCalledTimes(authoredSnapshots.length);
  });

  it("stops emitting and calls onclose after close()", () => {
    const socket = createMockIncidentSocket({ intervalMs: 100 });
    const onclose = vi.fn();
    const onmessage = vi.fn();
    socket.onclose = onclose;
    socket.onmessage = onmessage;

    vi.advanceTimersByTime(0);
    socket.start();
    socket.close();
    vi.advanceTimersByTime(100 * authoredSnapshots.length);

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onmessage).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(3);
  });
});
