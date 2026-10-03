import { useEffect, useMemo, useRef, useState } from "react";
import { replayLog } from "../net/replayLog.js";
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
 * docs/FRONTEND.md also specifies an explicit "replay: full simulated
 * fire" toggle - that would show the actual, complete truth alongside the
 * coordinator's filtered knowledge. There is no truth channel anywhere in
 * this schema or any mock data yet (live or recorded); this view says so
 * rather than fabricating one. What's shown below is the coordinator's
 * own recorded projection only, exactly as it would have looked live.
 */
export function ReplayView({ onExit }: ReplayViewProps) {
  const [index, setIndex] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
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

  const view = replayLog[index]!;
  const entities = useMemo(() => buildSceneEntities(view, scenarioMap), [view]);

  return (
    <div className="app-layout replay-view">
      <header className="replay-banner" role="status">
        <span className="replay-banner__label" ref={bannerLabelRef} tabIndex={-1}>
          REPLAY
        </span>
        <span>Commands disabled. Showing the coordinator&rsquo;s own recorded knowledge only.</span>
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

      <UrgentStrip report={latestUrgentReport(view)} audioState="idle" />
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
