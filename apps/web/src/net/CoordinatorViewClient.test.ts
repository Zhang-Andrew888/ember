import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import {
  createCoordinatorViewClient,
  parseIncomingMessage,
  type WebSocketLike,
} from "./CoordinatorViewClient.js";

describe("net/CoordinatorViewClient - parseIncomingMessage", () => {
  it("parses a bare CoordinatorView payload", () => {
    const result = parseIncomingMessage(JSON.stringify(fixtureCoordinatorView));
    expect(result?.sequence).toBe(fixtureCoordinatorView.sequence);
  });

  it("parses a wrapped { type, view } envelope", () => {
    const result = parseIncomingMessage(
      JSON.stringify({ type: "coordinator_view", view: fixtureCoordinatorView }),
    );
    expect(result?.sequence).toBe(fixtureCoordinatorView.sequence);
  });

  it("returns null for invalid JSON", () => {
    expect(parseIncomingMessage("{not json")).toBeNull();
  });

  it("returns null for a well-formed but schema-invalid payload", () => {
    expect(parseIncomingMessage(JSON.stringify({ hello: "world" }))).toBeNull();
  });
});

class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 0;
  closed = false;

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emitMessage(data: string): void {
    this.onmessage?.({ data });
  }

  emitServerClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("net/CoordinatorViewClient - createCoordinatorViewClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in connecting state with no view", () => {
    const sockets: FakeSocket[] = [];
    const client = createCoordinatorViewClient(() => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    expect(client.getState()).toEqual({ status: "connecting", view: null });
    client.close();
  });

  it("moves to open and applies the first valid view", () => {
    const sockets: FakeSocket[] = [];
    const client = createCoordinatorViewClient(() => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    sockets[0]!.emitOpen();
    sockets[0]!.emitMessage(JSON.stringify(fixtureCoordinatorView));

    expect(client.getState().status).toBe("open");
    expect(client.getState().view?.sequence).toBe(fixtureCoordinatorView.sequence);
    client.close();
  });

  it("ignores an invalid frame without changing state", () => {
    const sockets: FakeSocket[] = [];
    const client = createCoordinatorViewClient(() => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    sockets[0]!.emitOpen();
    sockets[0]!.emitMessage(JSON.stringify(fixtureCoordinatorView));
    sockets[0]!.emitMessage("not json");
    sockets[0]!.emitMessage(JSON.stringify({ garbage: true }));

    expect(client.getState().view?.sequence).toBe(fixtureCoordinatorView.sequence);
    client.close();
  });

  it("notifies subscribers on each state change", () => {
    const sockets: FakeSocket[] = [];
    const client = createCoordinatorViewClient(() => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    const listener = vi.fn();
    client.subscribe(listener);

    sockets[0]!.emitOpen();
    expect(listener).toHaveBeenCalled();
    client.close();
  });

  it("reconnects after an unexpected close", () => {
    const sockets: FakeSocket[] = [];
    const client = createCoordinatorViewClient(
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      { reconnectDelayMs: 500 },
    );

    sockets[0]!.emitOpen();
    sockets[0]!.emitServerClose();
    expect(client.getState().status).toBe("closed");
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    expect(client.getState().status).toBe("connecting");

    client.close();
  });

  it("does not reconnect after an explicit client close", () => {
    const sockets: FakeSocket[] = [];
    const client = createCoordinatorViewClient(
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      { reconnectDelayMs: 500 },
    );

    sockets[0]!.emitOpen();
    client.close();
    vi.advanceTimersByTime(5000);
    expect(sockets).toHaveLength(1);
  });

  it("preserves the last known view across a reconnect", () => {
    const sockets: FakeSocket[] = [];
    const client = createCoordinatorViewClient(
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      { reconnectDelayMs: 100 },
    );

    sockets[0]!.emitOpen();
    sockets[0]!.emitMessage(JSON.stringify(fixtureCoordinatorView));
    sockets[0]!.emitServerClose();
    vi.advanceTimersByTime(100);

    expect(client.getState().view?.sequence).toBe(fixtureCoordinatorView.sequence);
    client.close();
  });
});
