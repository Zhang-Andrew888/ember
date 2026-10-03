import { useCallback, useMemo, useRef, useState } from "react";
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

const INCIDENT_ID = import.meta.env.VITE_INCIDENT_ID ?? "demo";
const WS_URL = import.meta.env.VITE_INCIDENT_WS_URL;
const REST_BASE_URL = import.meta.env.VITE_INCIDENT_REST_BASE_URL;
const IS_MOCK_MODE = !WS_URL;

const EMPTY_ENTITIES = { agents: [], sites: [], fireCells: [] };

type Phase = "briefing" | "live";

export function App() {
  const [phase, setPhase] = useState<Phase>("briefing");
  const [starting, setStarting] = useState(false);
  const [client, setClient] = useState<CoordinatorViewClient | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const mockSocketRef = useRef<MockIncidentSocket | null>(null);
  const reducedMotion = useReducedMotion();

  const { status: connectionStatus, view } = useCoordinatorView(client);

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

  const handleSendMessage = useCallback(
    (text: string) => {
      if (IS_MOCK_MODE || !REST_BASE_URL) return;
      void fetch(`${REST_BASE_URL}/incidents/${encodeURIComponent(INCIDENT_ID)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }).catch(() => {
        // Best-effort: the server is authoritative, a failed send just leaves no receipt.
      });
    },
    [],
  );

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

  return (
    <div className="app-layout">
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
        />
      </div>
      <UrgentStrip report={view ? latestUrgentReport(view) : null} audioState="idle" />
      <AgentRail
        agents={view?.agents ?? []}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
      />
      {view?.incidentEnd ? <EndOverlay incidentEnd={view.incidentEnd} onStartAgain={handleStartAgain} /> : null}
    </div>
  );
}
