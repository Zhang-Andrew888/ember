import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCoordinatorViewClient,
  type CoordinatorViewClient,
} from "./net/CoordinatorViewClient.js";
import { createMockIncidentSocket, type MockIncidentSocket } from "./net/mockIncidentSocket.js";
import { resolveScenario } from "./net/scenarioSelection.js";
import {
  createIncident,
  resolveWebSocketUrl,
  startIncident,
} from "./net/incidentRestClient.js";
import { createProtocolWebSocket, type ProtocolWebSocket } from "./net/protocolWebSocket.js";
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
const INCIDENT_TOKEN = import.meta.env.VITE_INCIDENT_TOKEN as string | undefined;
const WS_URL = import.meta.env.VITE_INCIDENT_WS_URL as string | undefined;
/** Set to any value (including empty) to use `POST /incidents` + proxied REST/WS instead of mock. */
const REST_BASE_URL = import.meta.env.VITE_INCIDENT_REST_BASE_URL as string | undefined;
const HAS_LIVE_REST = REST_BASE_URL !== undefined;
const IS_MOCK_MODE = !WS_URL && !HAS_LIVE_REST;

const EMPTY_ENTITIES = { agents: [], sites: [], fireCells: [] };

type Phase = "briefing" | "live" | "replay";

export function App() {
  const [phase, setPhase] = useState<Phase>("briefing");
  const [starting, setStarting] = useState(false);
  const [client, setClient] = useState<CoordinatorViewClient | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const mockSocketRef = useRef<MockIncidentSocket | null>(null);
  const protocolSocketRef = useRef<ProtocolWebSocket | null>(null);
  const liveSessionRef = useRef<{ incidentId: string; token: string } | null>(null);
  const liveWsUrlRef = useRef<string | null>(null);
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

  // docs/COMMUNICATION.md: "At incident end, stop capture, cancel unapplied
  // commands and stale routine audio." Found via live testing that nothing
  // did this - a routine acknowledgement already pending/playing when
  // incidentEnd arrived just kept running past the debrief overlay, which
  // is exactly "a backlog of obsolete radio traffic" the same doc says the
  // debrief must not auto-play.
  useEffect(() => {
    if (view?.incidentEnd) speechStubRef.current.cancel();
  }, [view?.incidentEnd]);

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
    const url = liveWsUrlRef.current ?? WS_URL;
    if (url === undefined) {
      throw new Error("Live WebSocket URL is not configured");
    }
    const socket = createProtocolWebSocket(url);
    protocolSocketRef.current = socket;
    return socket;
  }, []);

  const handleStart = useCallback(async () => {
    setStarting(true);
    if (HAS_LIVE_REST) {
      const created = await createIncident(REST_BASE_URL ?? "");
      if (created === null) {
        setStarting(false);
        return;
      }
      liveSessionRef.current = { incidentId: created.incidentId, token: created.token };
      liveWsUrlRef.current = resolveWebSocketUrl(REST_BASE_URL ?? "", created.websocketEventsPath);
    }
    const nextClient = createCoordinatorViewClient(openSocket);
    setClient(nextClient);
    if (IS_MOCK_MODE) {
      mockSocketRef.current?.start();
    } else {
      const incidentId = liveSessionRef.current?.incidentId ?? INCIDENT_ID;
      const token = liveSessionRef.current?.token ?? INCIDENT_TOKEN;
      const restBase = HAS_LIVE_REST ? (REST_BASE_URL ?? "") : REST_BASE_URL;
      if (restBase !== undefined) {
        await startIncident(restBase, incidentId, token);
      }
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

    const socket = protocolSocketRef.current;
    if (socket !== null) {
      socket.sendCommand({
        type: "say",
        text,
        idempotencyKey: crypto.randomUUID(),
      });
    }
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
