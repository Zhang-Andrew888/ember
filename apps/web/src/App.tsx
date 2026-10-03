import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCoordinatorViewClient,
  type CoordinatorViewClient,
  type WebSocketLike,
} from "./net/CoordinatorViewClient.js";
import { createMockIncidentSocket, type MockIncidentSocket } from "./net/mockIncidentSocket.js";
import { resolveScenario } from "./net/scenarioSelection.js";
import { startIncident } from "./net/incidentRestClient.js";
import { useCoordinatorView } from "./state/useCoordinatorView.js";
import { useReducedMotion } from "./state/useReducedMotion.js";
import { createSpeechPlaybackStub } from "./state/speechPlaybackStub.js";
import { useSpeechPlaybackStub } from "./state/useSpeechPlaybackStub.js";
import { buildSceneEntities } from "./components/scene/sceneEntities.js";
import { scenarioMap } from "./map/scenarioMap.js";
import { routineReports, latestUrgentReport } from "./format/reports.js";
import { Briefing } from "./components/Briefing.js";
import { TopBar } from "./components/TopBar.js";
import { SceneView } from "./components/scene/SceneView.js";
import { ConversationPanel } from "./components/ConversationPanel.js";
import { UrgentStrip } from "./components/UrgentStrip.js";
import { AgentRail } from "./components/AgentRail.js";
import { EndOverlay } from "./components/EndOverlay.js";
import { ReplayView } from "./components/ReplayView.js";

const INCIDENT_ID = import.meta.env.VITE_INCIDENT_ID ?? "demo";
const WS_URL = import.meta.env.VITE_INCIDENT_WS_URL;
const REST_BASE_URL = import.meta.env.VITE_INCIDENT_REST_BASE_URL;
const IS_MOCK_MODE = !WS_URL;

const EMPTY_ENTITIES = { agents: [], sites: [], fireCells: [] };

type Phase = "briefing" | "live" | "replay";

export function App() {
  const [phase, setPhase] = useState<Phase>("briefing");
  const [starting, setStarting] = useState(false);
  const [client, setClient] = useState<CoordinatorViewClient | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const mockSocketRef = useRef<MockIncidentSocket | null>(null);
  const reducedMotion = useReducedMotion();

  const { status: connectionStatus, view } = useCoordinatorView(client);

  // Exact-text speech-playback stub (backlog item 4): drives UrgentStrip's
  // audioState and the composer's outgoing-acknowledgement indicator from
  // one shared single-channel stub, so an urgent report genuinely
  // interrupts a routine acknowledgement rather than playing both at once.
  const speechStubRef = useRef(createSpeechPlaybackStub());
  useEffect(() => () => speechStubRef.current.dispose(), []);
  const speechSnapshot = useSpeechPlaybackStub(speechStubRef.current);

  const lastSpokenUrgentSequence = useRef<number | null>(null);
  useEffect(() => {
    if (!view) return;
    const urgent = latestUrgentReport(view);
    if (!urgent) return;
    const sequence = urgent.sequence as number;
    if (lastSpokenUrgentSequence.current === sequence) return;
    lastSpokenUrgentSequence.current = sequence;
    speechStubRef.current.speak(urgent.text, { urgent: true });
  }, [view]);

  const openSocket = useCallback(() => {
    if (IS_MOCK_MODE) {
      // Dev/test-only state scenarios (backlog item 1), opted into via
      // ?scenario=<name> - never reachable without that query param, so
      // the default demo is unaffected. See net/scenarioSelection.ts.
      const scenarioOptions = resolveScenario(window.location.search);
      const socket = createMockIncidentSocket(scenarioOptions ?? undefined);
      mockSocketRef.current = socket;
      return socket;
    }
    // The real WebSocket's richer onmessage/close signatures are a superset of
    // WebSocketLike; narrowing through unknown avoids a brittle structural match.
    return new WebSocket(`${WS_URL}`) as unknown as WebSocketLike;
  }, []);

  const handleStart = useCallback(async () => {
    setStarting(true);
    const nextClient = createCoordinatorViewClient(openSocket);
    setClient(nextClient);
    if (IS_MOCK_MODE) {
      mockSocketRef.current?.start();
    } else if (REST_BASE_URL) {
      await startIncident(REST_BASE_URL, INCIDENT_ID);
    }
    setStarting(false);
    setPhase("live");
  }, [openSocket]);

  const handleStartAgain = useCallback(() => {
    window.location.reload();
  }, []);

  const handleReplay = useCallback(() => setPhase("replay"), []);
  const handleExitReplay = useCallback(() => setPhase("live"), []);

  const handleSendMessage = useCallback((text: string) => {
    // "Received: ..." (not "accepted"/applied) deliberately mirrors
    // CommandReceipt's own "received" status - this stub only ever claims
    // the message was received, never that a command was actually acted
    // on, since there's no real backend behind it to make that true.
    speechStubRef.current.speak(`Received: ${text}`, { urgent: false });

    if (IS_MOCK_MODE || !REST_BASE_URL) return;
    void fetch(`${REST_BASE_URL}/incidents/${encodeURIComponent(INCIDENT_ID)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => {
      // Best-effort: the server is authoritative, a failed send just leaves no receipt.
    });
  }, []);

  const entities = useMemo(
    () => (view ? buildSceneEntities(view, scenarioMap) : EMPTY_ENTITIES),
    [view],
  );

  const activeRecipientCallsign = useMemo(() => {
    if (!view?.activeRecipientId) return null;
    return view.agents.find((agent) => agent.id === view.activeRecipientId)?.callsign ?? null;
  }, [view]);

  if (phase === "briefing") {
    return <Briefing onStart={handleStart} starting={starting} />;
  }

  if (phase === "replay") {
    return <ReplayView onExit={handleExitReplay} />;
  }

  const hasEnded = Boolean(view?.incidentEnd);

  return (
    <div className="app-layout">
      {/*
        docs/FRONTEND.md: "freeze scene ... cancel unapplied commands" once
        ended. `inert` removes this whole region from the tab order and the
        accessibility tree (and blocks pointer events) while the end
        overlay is up - found live via Playwright that without it, Tab
        still reached the composer input and every scene control hidden
        behind the modal, including the message box.
      */}
      <div className="app-layout__content" inert={hasEnded || undefined}>
        <TopBar
          simTimeMs={view ? (view.simTimeMs as number) : null}
          wallElapsedMs={view ? (view.wallElapsedMs as number) : null}
          connectionStatus={connectionStatus}
        />
        <div className="app-layout__main">
          <SceneView
            entities={entities}
            selectedAgentId={selectedAgentId}
            onInspectAgent={setSelectedAgentId}
            reducedMotion={reducedMotion}
            simTimeMs={view ? (view.simTimeMs as number) : null}
          />
          <ConversationPanel
            reports={view ? routineReports(view) : []}
            activeRecipientCallsign={activeRecipientCallsign}
            onSendMessage={handleSendMessage}
            speechSnapshot={speechSnapshot}
          />
        </div>
        <UrgentStrip
          report={view ? latestUrgentReport(view) : null}
          audioState={speechSnapshot.urgent ? speechSnapshot.state : "idle"}
        />
        <AgentRail
          agents={view?.agents ?? []}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
      </div>
      {view?.incidentEnd ? (
        <EndOverlay incidentEnd={view.incidentEnd} onStartAgain={handleStartAgain} onReplay={handleReplay} />
      ) : null}
    </div>
  );
}
