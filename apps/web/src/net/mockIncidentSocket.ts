import type { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import type { WebSocketLike } from "./CoordinatorViewClient.js";

/**
 * Hand-authored CoordinatorView snapshots for the Slice-1 dev/test harness.
 * docs/IMPLEMENTATION_PLAN.md: "Use authored commands in the harness
 * temporarily; do not expose permanent map command controls." These are
 * literal, hand-written states - not a re-implementation of fire/movement
 * logic, which stays out of apps/web per AGENTS.md lane ownership.
 */
// Each snapshot's fields are the FULL cumulative state at that sim time,
// not a diff from the previous one (createMockIncidentSocket replays them
// independently) - a field left out reverts to the base fixture's value.
// Shared below so a later snapshot can't silently drop an earlier one's
// observation by accident.

const siteAWorkStarted: CoordinatorView["sites"][number] = {
  ...fixtureCoordinatorView.sites[0]!,
  observedCompletedWork: 0 as never,
  observedDamage: 0 as never,
  observedDestroyed: false,
  lastObservedAt: 95_000 as never,
  stale: false,
};

const crew1OnSiteReport: CoordinatorView["recentReports"][number] = {
  sequence: 4 as never,
  simTimeMs: 95_000 as never,
  agentId: "crew-1" as never,
  text: "Crew 1 on site at Ridge Cabins, beginning protection work.",
  urgent: false,
};

export const authoredSnapshots: CoordinatorView[] = [
  fixtureCoordinatorView,
  {
    ...fixtureCoordinatorView,
    sequence: 451 as CoordinatorView["sequence"],
    simTimeMs: 95_000 as CoordinatorView["simTimeMs"],
    wallElapsedMs: 19_000 as CoordinatorView["wallElapsedMs"],
    agents: [
      {
        ...fixtureCoordinatorView.agents[0]!,
        position: { kind: "node", nodeId: "placeholder-node-site-a" as never },
        state: "working",
        reportedAt: 95_000 as never,
      },
      fixtureCoordinatorView.agents[1]!,
      {
        ...fixtureCoordinatorView.agents[2]!,
        position: {
          kind: "edge",
          edgeId: "placeholder-edge-north-spread-1" as never,
          distanceAlongPolyline: 170 as never,
          direction: "forward",
          turnaroundTimeRemaining: 0 as never,
        },
        reportedAt: 95_000 as never,
      },
    ],
    sites: [siteAWorkStarted, fixtureCoordinatorView.sites[1]!, fixtureCoordinatorView.sites[2]!],
    recentReports: [...fixtureCoordinatorView.recentReports, crew1OnSiteReport],
  },
  {
    ...fixtureCoordinatorView,
    sequence: 452 as CoordinatorView["sequence"],
    simTimeMs: 100_000 as CoordinatorView["simTimeMs"],
    wallElapsedMs: 20_000 as CoordinatorView["wallElapsedMs"],
    agents: [
      {
        ...fixtureCoordinatorView.agents[0]!,
        position: { kind: "node", nodeId: "placeholder-node-site-a" as never },
        state: "working",
        reportedAt: 100_000 as never,
      },
      fixtureCoordinatorView.agents[1]!,
      {
        ...fixtureCoordinatorView.agents[2]!,
        position: {
          kind: "edge",
          edgeId: "placeholder-edge-north-spread-1" as never,
          distanceAlongPolyline: 200 as never,
          direction: "forward",
          turnaroundTimeRemaining: 0 as never,
        },
        reportedAt: 100_000 as never,
      },
    ],
    // Carries siteAWorkStarted forward - crew-1's work-in-progress observation
    // doesn't un-happen just because this snapshot doesn't re-touch the site.
    sites: [siteAWorkStarted, fixtureCoordinatorView.sites[1]!, fixtureCoordinatorView.sites[2]!],
    recentReports: [
      ...fixtureCoordinatorView.recentReports,
      crew1OnSiteReport,
      {
        sequence: 5 as never,
        simTimeMs: 100_000 as never,
        agentId: "scout" as never,
        text: "Scout urgent: fire crossing toward the north sector road.",
        urgent: true,
      },
    ],
  },
];

export interface MockIncidentSocket extends WebSocketLike {
  /** Begins emitting authored snapshots. No-op once already started. */
  start(): void;
}

export interface MockIncidentSocketOptions {
  readonly snapshots?: CoordinatorView[];
  readonly intervalMs?: number;
  /**
   * Simulates a connection that fails before ever opening (e.g. server
   * unreachable) - fires onerror then onclose instead of onopen. For the
   * dev/test "connection error" scenario.
   */
  readonly failToOpen?: boolean;
  /**
   * Simulates the server dropping an otherwise-healthy connection this many
   * ms after opening (CoordinatorViewClient's own reconnect logic takes it
   * from there). For the dev/test "disconnected and reconnecting" scenario.
   */
  readonly disconnectAfterMs?: number;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/**
 * A WebSocketLike implementation that never talks to a network. Playback
 * only begins once start() is called, so the UI can model "clock stopped
 * until Start" (docs/FRONTEND.md) even though the socket connects on mount.
 */
export function createMockIncidentSocket(options: MockIncidentSocketOptions = {}): MockIncidentSocket {
  const snapshots = options.snapshots ?? authoredSnapshots;
  const intervalMs = options.intervalMs ?? 2000;

  let readyState = CONNECTING;
  let started = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  const socket: MockIncidentSocket = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    get readyState() {
      return readyState;
    },
    start() {
      if (started) return;
      started = true;
      snapshots.forEach((snapshot, index) => {
        timers.push(
          setTimeout(() => {
            if (readyState !== OPEN) return;
            socket.onmessage?.({ data: JSON.stringify(snapshot) });
          }, index * intervalMs),
        );
      });
    },
    close() {
      if (readyState === CLOSED) return;
      readyState = CLOSED;
      for (const timer of timers) clearTimeout(timer);
      socket.onclose?.();
    },
  };

  if (options.failToOpen) {
    timers.push(
      setTimeout(() => {
        // onerror and onclose are two separate ticks, not one: a real
        // WebSocket failure (DNS, refused connection) has a gap between
        // them, and firing both in the same synchronous callback meant
        // React batched the two setState calls into one commit - the
        // "error" status was computed but never actually painted.
        socket.onerror?.();
        timers.push(
          setTimeout(() => {
            readyState = CLOSED;
            socket.onclose?.();
          }, 50),
        );
      }, 0),
    );
    return socket;
  }

  timers.push(
    setTimeout(() => {
      readyState = OPEN;
      socket.onopen?.();

      if (options.disconnectAfterMs !== undefined) {
        timers.push(
          setTimeout(() => {
            if (readyState !== OPEN) return;
            readyState = CLOSED;
            socket.onclose?.();
          }, options.disconnectAfterMs),
        );
      }
    }, 0),
  );

  return socket;
}
