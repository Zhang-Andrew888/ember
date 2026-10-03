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
    const socket = createMockIncidentSocket({ snapshots: authoredSnapshots, intervalMs: 100 });
    const received: unknown[] = [];
    socket.onmessage = (event) => received.push(JSON.parse(event.data));

    vi.advanceTimersByTime(0);
    socket.start();
    vi.advanceTimersByTime(100 * authoredSnapshots.length);

    expect(received).toHaveLength(authoredSnapshots.length);
    expect((received[0] as { sequence: number }).sequence).toBe(authoredSnapshots[0]!.sequence);
  });

  it("start() is idempotent", () => {
    const socket = createMockIncidentSocket({ snapshots: authoredSnapshots, intervalMs: 100 });
    const onmessage = vi.fn();
    socket.onmessage = onmessage;

    vi.advanceTimersByTime(0);
    socket.start();
    socket.start();
    vi.advanceTimersByTime(100 * authoredSnapshots.length);

    expect(onmessage).toHaveBeenCalledTimes(authoredSnapshots.length);
  });

  it("stops emitting and calls onclose after close()", () => {
    const socket = createMockIncidentSocket({ snapshots: authoredSnapshots, intervalMs: 100 });
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

  it("failToOpen fires onerror, then onclose on a later tick (never the same one), never onopen", () => {
    const socket = createMockIncidentSocket({ failToOpen: true });
    const onopen = vi.fn();
    const onerror = vi.fn();
    const onclose = vi.fn();
    socket.onopen = onopen;
    socket.onerror = onerror;
    socket.onclose = onclose;

    vi.advanceTimersByTime(0);

    expect(onopen).not.toHaveBeenCalled();
    expect(onerror).toHaveBeenCalledTimes(1);
    // onclose must not fire in the same tick as onerror - otherwise a
    // React host batches both state updates and "error" is never painted.
    expect(onclose).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(0);

    vi.advanceTimersByTime(100);
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(3);
  });

  it("calls onPlaybackEnded when the script finishes without incidentEnd", () => {
    const onPlaybackEnded = vi.fn();
    const socket = createMockIncidentSocket({
      snapshots: authoredSnapshots,
      intervalMs: 100,
      onPlaybackEnded,
    });
    vi.advanceTimersByTime(0);
    socket.start();
    vi.advanceTimersByTime(100 * authoredSnapshots.length + 100);
    expect(onPlaybackEnded).toHaveBeenCalledTimes(1);
    expect(socket.playbackEnded).toBe(true);
  });

  it("disconnectAfterMs opens normally, delivers snapshots, then self-closes", () => {
    const socket = createMockIncidentSocket({ snapshots: authoredSnapshots, intervalMs: 100, disconnectAfterMs: 500 });
    const onopen = vi.fn();
    const onclose = vi.fn();
    const received: unknown[] = [];
    socket.onopen = onopen;
    socket.onclose = onclose;
    socket.onmessage = (event) => received.push(JSON.parse(event.data));

    vi.advanceTimersByTime(0);
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(1);

    socket.start();
    vi.advanceTimersByTime(100 * authoredSnapshots.length);
    expect(received.length).toBeGreaterThan(0);
    expect(onclose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(3);
  });

  it("disconnectAfterMs does not fire a second close if close() was already called", () => {
    const socket = createMockIncidentSocket({ disconnectAfterMs: 200 });
    const onclose = vi.fn();
    socket.onclose = onclose;

    vi.advanceTimersByTime(0);
    socket.close();
    vi.advanceTimersByTime(200);

    expect(onclose).toHaveBeenCalledTimes(1);
  });
});
