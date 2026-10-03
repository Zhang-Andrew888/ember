import { useEffect, useMemo, useRef, useState } from "react";
import { mockRecording } from "../replay/mockRecording.js";
import { mergeTruthCells, truthFrameAt } from "../replay/recording.js";
import { truthForDisplay } from "../replay/truthGate.js";
import { buildSceneEntities } from "./scene/sceneEntities.js";
import { scenarioMap } from "../map/activeScenario.js";
import { SceneView } from "./scene/SceneView.js";
import { AgentRail } from "./AgentRail.js";
import { UrgentStrip } from "./UrgentStrip.js";
import { formatIncidentClock } from "../format/time.js";
import { useReducedMotion } from "../state/useReducedMotion.js";
import { latestUrgentReport } from "../format/reports.js";

export interface ReplayViewProps {
  readonly onExit: () => void;
}

/**
 * Seekable replay timeline (backlog item 5, docs/FRONTEND.md: "seekable
 * timeline ... commands disabled"), driven by a recorded mock event log
 * (net/replayLog.ts) - no packages/replay import, no sim-lane dependency.
 *
 * Replay is the ONLY place the full simulated fire may be shown
 * (docs/FRONTEND.md "replay: full simulated fire" toggle). It is off by
 * default; truthForDisplay() releases the truth frame only here, only with
 * the toggle on. The truth comes from the recording's separate truthFrames
 * channel (replay/recording.ts), never from the coordinator log itself.
 */
export function ReplayView({ onExit }: ReplayViewProps) {
  const [index, setIndex] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showFullFire, setShowFullFire] = useState(false);
  const reducedMotion = useReducedMotion();
  const bannerLabelRef = useRef<HTMLSpanElement>(null);

  // This view fully replaces the live page (not an overlay on top of it),
  // so entering replay unmounts whatever had focus (the EndOverlay's Replay
  // button) with nothing to take its place - found live via Playwright:
  // focus silently fell back to <body>. Same fix EndOverlay already uses
  // for its own mount (focus the element naming what just changed).
  useEffect(() => {
    bannerLabelRef.current?.focus();
  }, []);

  const replayLog = mockRecording.coordinatorLog;
  const view = replayLog[index]!;
  const baseEntities = useMemo(() => buildSceneEntities(view, scenarioMap), [view]);
  const truth = truthForDisplay({
    phase: "replay",
    showFullFire,
    frame: truthFrameAt(mockRecording.truthFrames, view.simTimeMs as number),
  });
  const entities = useMemo(
    () => (truth ? { ...baseEntities, fireCells: mergeTruthCells(baseEntities.fireCells, truth) } : baseEntities),
    [baseEntities, truth],
  );

  return (
    <div className="app-layout replay-view">
      <header className="replay-banner" role="status">
        <span className="replay-banner__label" ref={bannerLabelRef} tabIndex={-1}>
          REPLAY
        </span>
        <span>
          Commands disabled.{" "}
          {showFullFire
            ? "Showing the full simulated fire, including fire the coordinator never saw (dashed frames)."
            : "Showing the coordinator\u2019s own recorded knowledge only."}
        </span>
        <label className="replay-banner__toggle">
          <input type="checkbox" checked={showFullFire} onChange={(event) => setShowFullFire(event.target.checked)} />
          Replay: full simulated fire
        </label>
        <button type="button" onClick={onExit}>
          Exit replay
        </button>
      </header>

      <div className="app-layout__main">
        <SceneView
          entities={entities}
          selectedAgentId={selectedAgentId}
          onInspectAgent={setSelectedAgentId}
          reducedMotion={reducedMotion}
          simTimeMs={view.simTimeMs as number}
        />
      </div>

      <UrgentStrip
        report={latestUrgentReport(view)}
        callsign={null}
        audioState="idle"
        queuedUrgent={false}
      />
      <AgentRail agents={view.agents} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />

      <div className="replay-controls">
        <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          ◀ Previous event
        </button>
        <label htmlFor="replay-seek" className="sr-only">
          Replay position
        </label>
        <input
          id="replay-seek"
          type="range"
          min={0}
          max={replayLog.length - 1}
          value={index}
          onChange={(event) => setIndex(Number(event.target.value))}
          aria-valuetext={`${formatIncidentClock(view.simTimeMs)}, event ${index + 1} of ${replayLog.length}`}
        />
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(replayLog.length - 1, i + 1))}
          disabled={index === replayLog.length - 1}
        >
          Next event ▶
        </button>
        <span className="replay-controls__time">
          {formatIncidentClock(view.simTimeMs)} ({index + 1} / {replayLog.length})
        </span>
      </div>
    </div>
  );
}
