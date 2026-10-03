import type { CoordinatorView, IncidentEnd } from "@ember/domain";
import { revealFire } from "@ember/replay";
import { recordOf } from "@ember/simulation";
import type { IncidentSession } from "./session.js";
import type { ViewRecorder } from "./view-recorder.js";

/** Matches apps/web ReplayRecording + incident end metadata (web-local schema). */
export interface IncidentReplayExport {
  readonly coordinatorLog: readonly CoordinatorView[];
  readonly truthFrames: readonly { readonly timeMs: number; readonly burning: readonly number[]; readonly burned: readonly number[] }[];
  readonly end: IncidentEnd;
}

const TRUTH_FRAME_EVERY_MS = 10_000;

export function buildReplayExport(session: IncidentSession, recorder: ViewRecorder): IncidentReplayExport | null {
  const inc = session.incident;
  if (!inc.ended || inc.end === null) return null;

  const runRecord = recordOf(inc);
  const reveal = revealFire(runRecord, TRUTH_FRAME_EVERY_MS);
  const logged = recorder.coordinatorLog();
  const coordinatorLog = logged.length > 0 ? logged : [session.coordinatorView()];

  return {
    coordinatorLog,
    truthFrames: reveal.frames.map((f) => ({
      timeMs: f.timeMs,
      burning: [...f.burning],
      burned: [...f.burned],
    })),
    end: inc.end,
  };
}
