import type { CoordinatorView, IncidentEnd } from "@ember/domain";
import { recordOf } from "@ember/simulation";
import { revealFireOffLoop } from "./replay-offloop.js";
import type { IncidentSession } from "./session.js";
import type { ViewRecorder } from "./view-recorder.js";

/** Matches apps/web ReplayRecording + incident end metadata (web-local schema). */
export interface IncidentReplayExport {
  readonly coordinatorLog: readonly CoordinatorView[];
  readonly truthFrames: readonly { readonly timeMs: number; readonly burning: readonly number[]; readonly burned: readonly number[] }[];
  readonly end: IncidentEnd;
}

const TRUTH_FRAME_EVERY_MS = 10_000;

const cache = new WeakMap<IncidentSession, IncidentReplayExport>();
const inflight = new WeakMap<IncidentSession, Promise<IncidentReplayExport | null>>();

/**
 * Build the replay export for an ended incident. The result is immutable, so each session is
 * revealed once. Concurrent callers share that pass, which runs off the live-pump thread.
 */
export function buildReplayExport(session: IncidentSession, recorder: ViewRecorder): Promise<IncidentReplayExport | null> {
  const cached = cache.get(session);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = inflight.get(session);
  if (pending !== undefined) return pending;

  const inc = session.incident;
  if (!inc.ended || inc.end === null) return Promise.resolve(null);

  const job = assembleReplayExport(session, recorder).finally(() => {
    inflight.delete(session);
  });
  inflight.set(session, job);
  return job;
}

async function assembleReplayExport(session: IncidentSession, recorder: ViewRecorder): Promise<IncidentReplayExport | null> {
  const inc = session.incident;
  if (!inc.ended || inc.end === null) return null;

  const frames = await revealFireOffLoop(recordOf(inc), TRUTH_FRAME_EVERY_MS);
  const logged = recorder.coordinatorLog();
  const payload: IncidentReplayExport = {
    coordinatorLog: logged.length > 0 ? logged : [session.coordinatorView()],
    truthFrames: frames.map((frame) => ({
      timeMs: frame.timeMs,
      burning: frame.burning,
      burned: frame.burned,
    })),
    end: inc.end,
  };
  cache.set(session, payload);
  return payload;
}
