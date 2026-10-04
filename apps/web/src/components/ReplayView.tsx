import { useEffect, useMemo, useRef, useState } from "react";
import { mockRecording } from "../replay/mockRecording.js";
import { mergeTruthCells, truthFrameAt, type ReplayRecording } from "../replay/recording.js";
import { truthForDisplay } from "../replay/truthGate.js";
import { buildSceneEntities } from "./scene/sceneEntities.js";
import { scenarioMap } from "../map/activeScenario.js";
import { SceneView } from "./scene/SceneView.js";
import { AgentRail } from "./AgentRail.js";
import { UrgentStrip } from "./UrgentStrip.js";
import { formatElapsedWallTime, formatIncidentClock } from "../format/time.js";
import { useReducedMotion } from "../state/useReducedMotion.js";
import { latestUrgentReport } from "../format/reports.js";
import { replayStepDelayMs } from "../replay/playback.js";

export type ReplaySource = "incident" | "illustrative";

/** `incident` always carries this run's validated export; the illustrative sample never does. */
export type ReplayViewProps = { readonly onExit: () => void } & (
  | { readonly source: "illustrative"; readonly recording?: undefined }
  | { readonly source: "incident"; readonly recording: ReplayRecording }
);

export interface UrgentMarker {
  readonly index: number;
  readonly simTimeMs: number;
  readonly agentId: string;
  readonly text: string;
}

/** Recorded events where a new urgent report first appears. */
export function urgentMarkers(log: ReplayRecording["coordinatorLog"]): UrgentMarker[] {
  const markers: UrgentMarker[] = [];
  let lastSequence: number | null = null;
  log.forEach((view, index) => {
    const urgent = latestUrgentReport(view);
    if (urgent === null || (urgent.sequence as number) === lastSequence) return;
    lastSequence = urgent.sequence as number;
    markers.push({ index, simTimeMs: urgent.simTimeMs as number, agentId: urgent.agentId as string, text: urgent.text });
  });
  return markers;
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
export function ReplayView(props: ReplayViewProps) {
  const { onExit, source } = props;
  const bundle = props.source === "illustrative" ? mockRecording : props.recording;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
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

  const replayLog = bundle.coordinatorLog;

  useEffect(() => {
    if (!playing || index >= replayLog.length - 1) return;
    const curr = replayLog[index]!;
    const next = replayLog[index + 1]!;
    const delay = replayStepDelayMs((next.simTimeMs as number) - (curr.simTimeMs as number), reducedMotion);
    const id = window.setTimeout(() => setIndex((i) => i + 1), delay);
    return () => window.clearTimeout(id);
  }, [playing, index, replayLog, reducedMotion]);

  useEffect(() => {
    if (index >= replayLog.length - 1) setPlaying(false);
  }, [index, replayLog.length]);
  const view = replayLog[index]!;
  const markers = useMemo(() => urgentMarkers(replayLog), [replayLog]);
  const callsignFor = (agentId: string) =>
    view.agents.find((agent) => agent.id === agentId)?.callsign ?? agentId;
  const baseEntities = useMemo(() => buildSceneEntities(view, scenarioMap, { phase: "replay" }), [view]);
  const truth = truthForDisplay({
    phase: "replay",
    showFullFire,
    frame: truthFrameAt(bundle.truthFrames, view.simTimeMs as number),
  });
  const entities = useMemo(
    () =>
      truth
        ? {
            ...baseEntities,
            // Truth cells the recorded view's current-fire layer already draws are not shown again as unseen frames.
            fireCells: mergeTruthCells(
              baseEntities.fireCells,
              truth,
              scenarioMap,
              new Set(baseEntities.currentFire?.cells.map((cell) => cell.gridCellIndex)),
            ),
          }
        : baseEntities,
    [baseEntities, truth],
  );

  return (
    <div className="app-layout replay-view">
      <header className="replay-banner" role="status">
        <span className="replay-banner__label" ref={bannerLabelRef} tabIndex={-1}>
          REPLAY
        </span>
        {source === "illustrative" ? (
          <span className="replay-banner__notice">Illustrative recording, not from this run.</span>
        ) : (
          <span className="replay-banner__notice">Recorded from this run.</span>
        )}
        <span>
          Commands disabled.{" "}
          {showFullFire
            ? "Showing the full simulated fire, including fire the coordinator has not observed (dashed frames)."
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
          mapAssignMode={false}
          mapPreviewFrom={null}
          mapPreviewTo={null}
          onMapDestinationPick={() => undefined}
          mapCommandPanel={null}
        />
      </div>

      <UrgentStrip
        report={latestUrgentReport(view)}
        callsign={(() => {
          const urgent = latestUrgentReport(view);
          return urgent === null ? null : callsignFor(urgent.agentId as string);
        })()}
        audioState="idle"
        queuedUrgent={false}
      />
      <AgentRail
        agents={view.agents}
        plans={view.agentPlans}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
      />

      <div className="replay-controls">
        <button
          type="button"
          className="replay-controls__play"
          onClick={() => {
            if (!playing && index >= replayLog.length - 1) {
              setIndex(0);
              setPlaying(true);
              return;
            }
            setPlaying((p) => !p);
          }}
          aria-pressed={playing}
        >
          {playing ? "Pause" : "Play"}
        </button>
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
          onChange={(event) => {
            setPlaying(false);
            setIndex(Number(event.target.value));
          }}
          aria-valuetext={`Event ${index + 1} of ${replayLog.length}, ${formatIncidentClock(view.simTimeMs)} incident time`}
        />
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(replayLog.length - 1, i + 1))}
          disabled={index === replayLog.length - 1}
        >
          Next event ▶
        </button>
        <span className="replay-controls__time">
          Event {index + 1} of {replayLog.length} · {formatIncidentClock(view.simTimeMs)} incident time ·{" "}
          {formatElapsedWallTime(view.wallElapsedMs as number)} real time
        </span>
        <p className="replay-controls__hint">
          Steps move between recorded events, which are not evenly spaced in time.
        </p>
        {markers.length > 0 ? (
          <details className="replay-controls__markers">
            <summary>Urgent reports in this recording ({markers.length})</summary>
            <ul>
              {markers.map((marker) => (
                <li key={marker.index}>
                  <button type="button" onClick={() => setIndex(marker.index)} aria-current={marker.index === index || undefined}>
                    {formatIncidentClock(marker.simTimeMs)} {callsignFor(marker.agentId)}: {marker.text}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
