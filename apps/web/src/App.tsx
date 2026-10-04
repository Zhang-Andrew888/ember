import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCoordinatorViewClient,
  type CoordinatorViewClient,
} from "./net/CoordinatorViewClient.js";
import { createMockIncidentSocket, type MockIncidentSocket } from "./net/mockIncidentSocket.js";
import { resolveScenario } from "./net/scenarioSelection.js";
import {
  createIncident,
  fetchIncidentReplay,
  resolveWebSocketUrl,
  startIncident,
  type IncidentReplayRecording,
} from "./net/incidentRestClient.js";
import { newCommandId } from "./net/commandId.js";
import { planStart, START_FAILED_MESSAGE } from "./net/startPlan.js";
import { transportModeFromStartPlan } from "./net/transportMode.js";
import { createProtocolWebSocket, type ProtocolWebSocket } from "./net/protocolWebSocket.js";
import { dispatchPttRelease } from "./net/pttRelease.js";
import { mockWireRepliesForSay } from "./net/mockCommandSimulator.js";
import { useCoordinatorView } from "./state/useCoordinatorView.js";
import { useReducedMotion } from "./state/useReducedMotion.js";
import { createSpeechPlaybackStub } from "./state/speechPlaybackStub.js";
import { useSpeechPlaybackStub } from "./state/useSpeechPlaybackStub.js";
import { buildConversationTranscript } from "./conversation/transcript.js";
import { buildSceneEntities } from "./components/scene/sceneEntities.js";
import { briefingContent } from "./briefing/briefingInfo.js";
import { scenarioMap } from "./map/activeScenario.js";
import { latestUrgentReport } from "./format/reports.js";
import { isDemoMode } from "./demo/demoMode.js";
import { Briefing } from "./components/Briefing.js";
import { TopBar } from "./components/TopBar.js";
import { SceneView } from "./components/scene/SceneView.js";
import { ConversationPanel } from "./components/ConversationPanel.js";
import { UrgentStrip } from "./components/UrgentStrip.js";
import { AgentRail } from "./components/AgentRail.js";
import { EndOverlay } from "./components/EndOverlay.js";
import { ReplayView, type ReplaySource } from "./components/ReplayView.js";
import { ConnectionBanner } from "./components/ConnectionBanner.js";
import { DemoBanner } from "./components/DemoBanner.js";
import { MockPlaybackEndedOverlay } from "./components/MockPlaybackEndedOverlay.js";
import { handleGrokAudioCue, PreparedSpeechPlayback } from "./net/grokSpeechPlayback.js";
import { transcribeViaServer } from "./net/grokStt.js";
import { fetchServerHealth, type ServerHealthResponse } from "./net/serverHealth.js";
import { MapCommandPanel } from "./components/MapCommandPanel.js";
import { applyReceipts, registerSentCommand, type MapCommandDelivery } from "./command/mapCommandDelivery.js";
import { buildMoveDirectionDraft, type MapMovementDraft } from "./map/moveDirectionCommand.js";
import { agentWorldPoint, sceneToWorld, worldToScenePoint } from "./map/worldPoint.js";

const INCIDENT_ID = import.meta.env.VITE_INCIDENT_ID ?? "demo";
const INCIDENT_TOKEN = import.meta.env.VITE_INCIDENT_TOKEN as string | undefined;
const WS_URL = import.meta.env.VITE_INCIDENT_WS_URL as string | undefined;
/** Set to any value (including empty) to use `POST /incidents` + proxied REST/WS instead of mock. */
const REST_BASE_URL = import.meta.env.VITE_INCIDENT_REST_BASE_URL as string | undefined;
const HAS_LIVE_REST = REST_BASE_URL !== undefined;
const START_PLAN = planStart({ wsUrl: WS_URL, restBase: REST_BASE_URL });
const TRANSPORT_MODE = transportModeFromStartPlan(START_PLAN);
const IS_MOCK_MODE = START_PLAN.kind === "mock";
const USE_GROK_VOICE = import.meta.env.VITE_GROK_VOICE === "1";
const GROK_LIVE = USE_GROK_VOICE && HAS_LIVE_REST;

const EMPTY_ENTITIES = { agents: [], sites: [], fireCells: [], routes: [], forecast: null };

type Phase = "briefing" | "live" | "replay";

export function App() {
  const demoMode = isDemoMode(typeof window !== "undefined" ? window.location.search : "");
  const [phase, setPhase] = useState<Phase>("briefing");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [client, setClient] = useState<CoordinatorViewClient | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mapAssignMode, setMapAssignMode] = useState(false);
  const [mapDraft, setMapDraft] = useState<MapMovementDraft | null>(null);
  const [mapPickHint, setMapPickHint] = useState<string | null>(null);
  const [mapDeliveries, setMapDeliveries] = useState<readonly MapCommandDelivery[]>([]);
  const [replaySource, setReplaySource] = useState<ReplaySource>("illustrative");
  const [replayRecording, setReplayRecording] = useState<IncidentReplayRecording | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [mockPlaybackEnded, setMockPlaybackEnded] = useState(false);
  const mockSocketRef = useRef<MockIncidentSocket | null>(null);
  const protocolSocketRef = useRef<ProtocolWebSocket | null>(null);
  const liveSessionRef = useRef<{ incidentId: string; token: string } | null>(null);
  const liveWsUrlRef = useRef<string | null>(null);
  const grokPlaybackRef = useRef(new PreparedSpeechPlayback());
  const reducedMotion = useReducedMotion();
  const [serverHealth, setServerHealth] = useState<ServerHealthResponse | null>(null);

  useEffect(() => {
    if (!HAS_LIVE_REST) return;
    const base = REST_BASE_URL ?? "";
    void fetchServerHealth(base).then(setServerHealth);
  }, []);

  const { status: connectionStatus, view, sideband } = useCoordinatorView(client);

  const speechStubRef = useRef(createSpeechPlaybackStub());
  useEffect(() => () => speechStubRef.current.dispose(), []);
  const speechSnapshot = useSpeechPlaybackStub(speechStubRef.current);

  const lastSpokenUrgentSequence = useRef<number | null>(null);
  useEffect(() => {
    if (GROK_LIVE || !view) return;
    const urgent = latestUrgentReport(view);
    if (!urgent) return;
    const sequence = urgent.sequence as number;
    if (lastSpokenUrgentSequence.current === sequence) return;
    lastSpokenUrgentSequence.current = sequence;
    speechStubRef.current.speak(urgent.text, { urgent: true });
  }, [view]);

  const lastReceiptCount = useRef(0);
  useEffect(() => {
    if (GROK_LIVE) return;
    if (sideband.receipts.length <= lastReceiptCount.current) return;
    const newReceipts = sideband.receipts.slice(lastReceiptCount.current);
    lastReceiptCount.current = sideband.receipts.length;
    for (const receipt of newReceipts) {
      if (receipt.reply.trim().length > 0) {
        speechStubRef.current.speak(receipt.reply, { urgent: false });
      }
    }
  }, [sideband.receipts]);

  const lastAudioCueCount = useRef(0);
  useEffect(() => {
    if (!GROK_LIVE) return;
    const session = liveSessionRef.current;
    if (session === null) return;
    if (sideband.audioCues.length <= lastAudioCueCount.current) return;
    const cues = sideband.audioCues.slice(lastAudioCueCount.current);
    lastAudioCueCount.current = sideband.audioCues.length;
    for (const cue of cues) {
      handleGrokAudioCue(cue, grokPlaybackRef.current, {
        apiBase: REST_BASE_URL ?? "",
        incidentId: session.incidentId,
        token: session.token,
        notifyPlayback: (itemId, outcome) => {
          protocolSocketRef.current?.sendCommand({ type: "speech_playback", itemId, outcome });
        },
      });
    }
  }, [sideband.audioCues]);

  const grokStt = useMemo(() => {
    if (!GROK_LIVE) return undefined;
    return (audio: Blob) => {
      const session = liveSessionRef.current;
      if (session === null) return Promise.resolve(null);
      return transcribeViaServer(REST_BASE_URL ?? "", session.incidentId, session.token, audio);
    };
  }, []);

  useEffect(() => {
    if (view?.incidentEnd) {
      speechStubRef.current.cancel();
      grokPlaybackRef.current.stopAll();
    }
  }, [view?.incidentEnd]);

  const openSocket = useCallback(() => {
    if (IS_MOCK_MODE) {
      const scenarioOptions = resolveScenario(window.location.search);
      const socket = createMockIncidentSocket({
        ...(scenarioOptions ?? {}),
        onPlaybackEnded: () => setMockPlaybackEnded(true),
      });
      mockSocketRef.current = socket;
      return socket;
    }
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
    setStartError(null);
    setMockPlaybackEnded(false);
    // A pre-configured WebSocket URL skips incident creation (see net/startPlan.ts).
    if (START_PLAN.kind === "create-incident") {
      const created = await createIncident(REST_BASE_URL ?? "");
      if (created === null) {
        setStarting(false);
        setStartError(START_FAILED_MESSAGE);
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

  const replayOffer = IS_MOCK_MODE ? "illustrative" : HAS_LIVE_REST ? "this-run" : "none";

  const handleReplay = useCallback(async () => {
    setReplayError(null);
    if (IS_MOCK_MODE) {
      setReplaySource("illustrative");
      setReplayRecording(null);
      setPhase("replay");
      return;
    }
    const incidentId = liveSessionRef.current?.incidentId ?? INCIDENT_ID;
    const token = liveSessionRef.current?.token ?? INCIDENT_TOKEN;
    if (!HAS_LIVE_REST || token === undefined) {
      setReplayError("Replay is not available for this session.");
      return;
    }
    setReplayLoading(true);
    const result = await fetchIncidentReplay(REST_BASE_URL ?? "", incidentId, token);
    setReplayLoading(false);
    if (result.status === "ok") {
      setReplaySource("incident");
      setReplayRecording(result.recording);
      setPhase("replay");
      return;
    }
    setReplayError(
      result.status === "active"
        ? "This run is still active; replay unlocks when the incident ends."
        : "Could not load replay for this run.",
    );
  }, []);

  const handleExitReplay = useCallback(() => setPhase("live"), []);

  const dispatchSay = useCallback(
    (text: string): string => {
      const commandId = newCommandId();
      const simTimeMs = view ? (view.simTimeMs as number) : 0;

      const socket = protocolSocketRef.current;
      if (socket !== null) {
        socket.sendCommand({ type: "say", text, idempotencyKey: commandId });
        return commandId;
      }

      if (IS_MOCK_MODE) {
        const frames = mockWireRepliesForSay(text, simTimeMs, commandId, view);
        for (const [index, frame] of frames.entries()) {
          setTimeout(() => mockSocketRef.current?.deliver(frame), 200 + index * 120);
        }
      }
      return commandId;
    },
    [view],
  );

  const handleSendMessage = useCallback(
    (text: string) => {
      dispatchSay(text);
    },
    [dispatchSay],
  );

  useEffect(() => {
    setMapDeliveries((rows) => applyReceipts(rows, sideband.receipts));
  }, [sideband.receipts]);

  const selectedAgent = useMemo(
    () => view?.agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [view, selectedAgentId],
  );

  const mapPreviewFrom = useMemo(() => {
    if (selectedAgent === null || view === null) return null;
    const scene = buildSceneEntities(view, scenarioMap).agents.find((a) => a.id === selectedAgent.id);
    return scene ? { x: scene.position.x, z: scene.position.z } : null;
  }, [selectedAgent, view]);

  const mapPreviewTo = useMemo(() => {
    if (mapDraft === null) return null;
    return worldToScenePoint(mapDraft.to, scenarioMap.worldMeters);
  }, [mapDraft]);

  const latestMapDelivery = mapDeliveries.length > 0 ? mapDeliveries[mapDeliveries.length - 1]! : null;

  const handleMapDestinationPick = useCallback(
    (sceneX: number, sceneZ: number) => {
      if (!mapAssignMode || selectedAgent === null) return;
      const from = agentWorldPoint(scenarioMap, selectedAgent.position);
      if (from === null) {
        setMapPickHint("Could not read the crew position.");
        return;
      }
      const to = sceneToWorld(sceneX, sceneZ, scenarioMap.worldMeters);
      const draft = buildMoveDirectionDraft({
        agentId: selectedAgent.id as string,
        callsign: selectedAgent.callsign,
        from,
        to,
      });
      if (draft === null) {
        setMapPickHint("Choose a destination at least 25 m from the crew.");
        setMapDraft(null);
        return;
      }
      setMapPickHint(null);
      setMapDraft(draft);
      setMapAssignMode(false);
    },
    [mapAssignMode, selectedAgent],
  );

  const handleSendMapCommand = useCallback(() => {
    if (mapDraft === null) return;
    const commandId = dispatchSay(mapDraft.commandText);
    setMapDeliveries((rows) =>
      registerSentCommand(rows, {
        commandId,
        commandText: mapDraft.commandText,
        agentId: mapDraft.agentId,
        callsign: mapDraft.callsign,
      }),
    );
    setMapDraft(null);
  }, [dispatchSay, mapDraft]);

  const handlePttBegin = useCallback(() => {
    speechStubRef.current.setRecording(true);
    protocolSocketRef.current?.sendCommand({ type: "ptt_begin" });
  }, []);

  const handlePttRelease = useCallback(
    (text: string) => {
      speechStubRef.current.setRecording(false);
      dispatchPttRelease({
        transcript: text,
        live: protocolSocketRef.current,
        mockMode: IS_MOCK_MODE,
        dispatchSay,
      });
    },
    [dispatchSay],
  );

  const handlePttCancel = useCallback(() => {
    speechStubRef.current.setRecording(false);
    protocolSocketRef.current?.sendCommand({ type: "ptt_lost_focus", transcript: "" });
  }, []);

  const transcript = useMemo(
    () => buildConversationTranscript(view, sideband),
    [view, sideband],
  );

  const entities = useMemo(
    () => (view ? buildSceneEntities(view, scenarioMap) : EMPTY_ENTITIES),
    [view],
  );

  const activeRecipientCallsign = useMemo(() => {
    if (!view?.activeRecipientId) return null;
    return view.agents.find((agent) => agent.id === view.activeRecipientId)?.callsign ?? null;
  }, [view]);

  const urgentCallsign = useMemo(() => {
    const urgent = view ? latestUrgentReport(view) : null;
    if (!urgent || !view) return null;
    return view.agents.find((agent) => agent.id === urgent.agentId)?.callsign ?? null;
  }, [view]);

  const composerDisabled =
    connectionStatus !== "open" || Boolean(view?.incidentEnd) || (IS_MOCK_MODE && mockPlaybackEnded);

  useEffect(() => {
    if (phase !== "live") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "m" && event.key !== "M") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (composerDisabled || selectedAgentId === null) return;
      event.preventDefault();
      setMapAssignMode((value) => !value);
      setMapPickHint(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, selectedAgentId, composerDisabled]);

  const mapCommandPanel = (
    <MapCommandPanel
      assignMode={mapAssignMode}
      onToggleAssignMode={() => {
        setMapAssignMode((value) => !value);
        setMapPickHint(null);
      }}
      selectedCallsign={selectedAgent?.callsign ?? null}
      selectedAgentId={selectedAgentId}
      draft={mapDraft}
      pickHint={mapPickHint}
      delivery={latestMapDelivery}
      disabled={composerDisabled}
      onSend={handleSendMapCommand}
      onCancelDraft={() => {
        setMapDraft(null);
        setMapPickHint(null);
      }}
    />
  );

  if (phase === "briefing") {
    return (
      <Briefing
        onStart={handleStart}
        starting={starting}
        content={briefingContent(scenarioMap, IS_MOCK_MODE)}
        demoMode={demoMode}
        transportMode={TRANSPORT_MODE}
        error={startError}
      />
    );
  }

  if (phase === "replay") {
    return (
      <ReplayView
        onExit={handleExitReplay}
        source={replaySource}
        {...(replayRecording === null ? {} : { recording: replayRecording })}
      />
    );
  }

  const hasEnded = Boolean(view?.incidentEnd);
  const mockFrozen = IS_MOCK_MODE && mockPlaybackEnded && !hasEnded;

  return (
    <div className="app-layout">
      {demoMode ? <DemoBanner /> : null}
      <ConnectionBanner status={connectionStatus} />
      <div className="app-layout__content" inert={hasEnded || mockFrozen || undefined}>
        <TopBar
          transportMode={TRANSPORT_MODE}
          serverHealth={serverHealth}
          simTimeMs={view ? (view.simTimeMs as number) : null}
          wallElapsedMs={view ? (view.wallElapsedMs as number) : null}
          connectionStatus={connectionStatus}
          speechSnapshot={speechSnapshot}
        />
        <div className="app-layout__main">
          <SceneView
            entities={entities}
            selectedAgentId={selectedAgentId}
            onInspectAgent={setSelectedAgentId}
            reducedMotion={reducedMotion}
            simTimeMs={view ? (view.simTimeMs as number) : null}
            mapAssignMode={mapAssignMode}
            mapPreviewFrom={mapPreviewFrom}
            mapPreviewTo={mapPreviewTo}
            onMapDestinationPick={handleMapDestinationPick}
            mapCommandPanel={mapCommandPanel}
          />
          <ConversationPanel
            transcript={transcript}
            activeRecipientCallsign={activeRecipientCallsign}
            onSendMessage={handleSendMessage}
            onPttBegin={handlePttBegin}
            onPttRelease={handlePttRelease}
            onPttCancel={handlePttCancel}
            composerDisabled={composerDisabled}
            demoMode={demoMode}
            speechSnapshot={speechSnapshot}
            {...(grokStt === undefined ? {} : { grokStt })}
          />
        </div>
        <UrgentStrip
          report={view ? latestUrgentReport(view) : null}
          callsign={urgentCallsign}
          audioState={speechSnapshot.urgent ? speechSnapshot.state : "idle"}
          queuedUrgent={speechSnapshot.queuedUrgent}
        />
        <AgentRail
          agents={view?.agents ?? []}
          plans={view?.agentPlans ?? []}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
      </div>
      {mockFrozen ? <MockPlaybackEndedOverlay onReload={handleStartAgain} /> : null}
      {view?.incidentEnd ? (
        <EndOverlay
          incidentEnd={view.incidentEnd}
          onStartAgain={handleStartAgain}
          onReplay={() => {
            void handleReplay();
          }}
          replayOffer={replayOffer}
          replayLoading={replayLoading}
          replayError={replayError}
        />
      ) : null}
    </div>
  );
}
