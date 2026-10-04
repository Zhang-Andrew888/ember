import { useEffect, useRef, useState } from "react";
import type { CoordinatorView } from "@ember/domain";
import { playbackWallElapsedMs } from "./playbackClock.js";

export interface SnapshotClock {
  /** Real ms since the latest snapshot arrived; null before the first or once the run ended. */
  readonly snapshotAgeMs: number | null;
  /** Remaining-time source for the header: the snapshot's own value, or the playback clock for a recording. */
  readonly wallElapsedMs: number | null;
}

const TICK_MS = 1_000;

/**
 * Real-time context for the latest view. Live timing stays authoritative: the world is never
 * extrapolated, only the age of the last snapshot is reported. A recorded showcase has long gaps
 * between frames, so its countdown follows playback time instead of freezing on the last frame.
 */
export function useSnapshotClock(view: CoordinatorView | null, options: { readonly recordedPlayback: boolean }): SnapshotClock {
  const arrival = useRef<{ view: CoordinatorView; atMs: number } | null>(null);
  const firstArrival = useRef<{ wallElapsedMs: number; atMs: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => performance.now());

  if (view !== null && arrival.current?.view !== view) {
    const atMs = performance.now();
    arrival.current = { view, atMs };
    firstArrival.current ??= { wallElapsedMs: view.wallElapsedMs as number, atMs };
  }

  const ended = Boolean(view?.incidentEnd);
  useEffect(() => {
    if (view === null || ended) return;
    const timer = setInterval(() => setNowMs(performance.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [view === null, ended]);

  if (view === null) return { snapshotAgeMs: null, wallElapsedMs: null };
  const snapshotAgeMs = ended || arrival.current === null ? null : Math.max(0, nowMs - arrival.current.atMs);
  const own = view.wallElapsedMs as number;
  if (!options.recordedPlayback || ended || firstArrival.current === null) return { snapshotAgeMs, wallElapsedMs: own };
  return {
    snapshotAgeMs,
    wallElapsedMs: playbackWallElapsedMs(own, firstArrival.current, nowMs),
  };
}
