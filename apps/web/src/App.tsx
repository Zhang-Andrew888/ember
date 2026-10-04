import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createCoordinatorViewClient,
  type CoordinatorViewClient,
} from "./net/CoordinatorViewClient.js";
import { createMockIncidentSocket, type MockIncidentSocket } from "./net/mockIncidentSocket.js";
import { resolveScenario } from "./net/scenarioSelection.js";
import {
  createIncident,
  fetchIncidentReplay,
  fetchScenarioBriefing,
  resolveWebSocketUrl,
  startIncident,
  type IncidentReplayRecording,
} from "./net/incidentRestClient.js";
import type { PublicScenarioBriefing } from "@ember/domain";
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
import { describeCrew } from "./components/crewDetails.js";
import { isDemoMode } from "./demo/demoMode.js";
import { Briefing } from "./components/Briefing.js";
import { TopBar } from "./components/TopBar.js";
import { SceneView } from "./components/scene/SceneView.js";
import { ConversationPanel, type ComposerPrefill } from "./components/ConversationPanel.js";
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
import { deriveDelivery, type CommandSource, type SentCommand } from "./command/commandDelivery.js";
import { buildDirectionalDraft, buildMoveDirectionDraft, type MapMovementDraft } from "./map/moveDirectionCommand.js";
import type { CompassDirection } from "@ember/domain";
import { INITIAL_LIVE_AUDIO, liveAudioReducer, liveAudioSnapshot } from "./state/liveAudioStatus.js";
import { useServerNotice } from "./state/useServerNotice.js";
import { useSnapshotClock } from "./state/useSnapshotClock.js";
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

const EMPTY_ENTITIES = { agents: [], sites: [], fireCells: [], currentFire: null, firebreaks: [], clearing: [], plannedLine: [], routes: [], forecast: null };

type Phase = "briefing" | "live" | "replay";

export function App() {
  const demoMode = isDemoMode(typeof window !== "undefined" ? window.location.search : "");
  const [phase, setPhase] = useState<Phase>("briefing");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [client, setClient] = useState<CoordinatorViewClient | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mapPanelOpen, setMapPanelOpen] = useState(true);
  const [mapAssignMode, setMapAssignMode] = useState(false);
  const [mapDraft, setMapDraft] = useState<MapMovementDraft | null>(null);
  const [mapPickHint, setMapPickHint] = useState<string | null>(null);
  const [sentCommands, setSentCommands] = useState<readonly SentCommand[]>([]);
  const [composerPrefill, setComposerPrefill] = useState<ComposerPrefill | null>(null);
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
  const [liveAudio, dispatchLiveAudio] = useReducer(liveAudioReducer, INITIAL_LIVE_AUDIO);
  const liveHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusLiveOnEnter = useRef(false);
  const reducedMotion = useReducedMotion();
  const [serverHealth, setServerHealth] = useState<ServerHealthResponse | null>(null);
  const [liveScenario, setLiveScenario] = useState<PublicScenarioBriefing | null>(null);
  const briefing = useMemo(
    () =>
      briefingContent(scenarioMap, IS_MOCK_MODE, typeof window === "undefined" ? "" : window.location.search, liveScenario),
    [liveScenario],
  );

  useEffect(() => {
    if (!HAS_LIVE_REST) return;
    const base = REST_BASE_URL ?? "";
    void fetchServerHealth(base).then(setServerHealth);
    // The briefing's starting picture comes from the server's published scenario, never the bundled map.
    void fetchScenarioBriefing(base).then(setLiveScenario);
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
      dispatchLiveAudio({ kind: "cue", cue });
      handleGrokAudioCue(cue, grokPlaybackRef.current, {
        apiBase: REST_BASE_URL ?? "",
        incidentId: session.incidentId,
        token: session.token,
        notifyPlayback: (itemId, outcome) => {
          protocolSocketRef.current?.sendCommand({ type: "speech_playback", itemId, outcome });
        },
        onPlaying: (itemId) => dispatchLiveAudio({ kind: "playing", itemId }),
        onOutcome: (itemId, outcome) => dispatchLiveAudio({ kind: "outcome", itemId, outcome }),
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
      dispatchLiveAudio({ kind: "stop" });
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
    try {
      // A pre-configured WebSocket URL skips incident creation (see net/startPlan.ts).
      if (START_PLAN.kind === "create-incident") {
        const created = await createIncident(REST_BASE_URL ?? "");
        if (created === null) {
          setStartError(START_FAILED_MESSAGE);
          return;
        }
        liveSessionRef.current = { incidentId: created.incidentId, token: created.token };
        liveWsUrlRef.current = resolveWebSocketUrl(REST_BASE_URL ?? "", created.websocketEventsPath);
        // The incident's own scenario is authoritative over the pre-start briefing fetch.
        if (created.scenario !== null) setLiveScenario(created.scenario);
      }
      const nextClient = createCoordinatorViewClient(openSocket);
      if (!IS_MOCK_MODE) {
        const incidentId = liveSessionRef.current?.incidentId ?? INCIDENT_ID;
        const token = liveSessionRef.current?.token ?? INCIDENT_TOKEN;
        const restBase = HAS_LIVE_REST ? (REST_BASE_URL ?? "") : REST_BASE_URL;
        if (restBase !== undefined && !(await startIncident(restBase, incidentId, token))) {
          nextClient.close();
          setStartError("Check that the server is running and reachable, then try again.");
          return;
        }
      }
      setClient(nextClient);
      if (IS_MOCK_MODE) mockSocketRef.current?.start();
      focusLiveOnEnter.current = true;
      setPhase("live");
    } catch {
      setStartError("Check the connection and try again.");
    } finally {
      setStarting(false);
    }
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

  const noticeCountRef = useRef(0);
  noticeCountRef.current = sideband.notices.length;
  const receiptCountRef = useRef(0);
  receiptCountRef.current = sideband.receipts.length;

  const dispatchSay = useCallback(
    (text: string): { readonly commandId: string; readonly submitted: boolean } => {
      const commandId = newCommandId();
      const simTimeMs = view ? (view.simTimeMs as number) : 0;

      const socket = protocolSocketRef.current;
      if (socket !== null) {
        return { commandId, submitted: socket.sendCommand({ type: "say", text, idempotencyKey: commandId }) };
      }

      if (IS_MOCK_MODE) {
        const frames = mockWireRepliesForSay(text, simTimeMs, commandId);
        for (const [index, frame] of frames.entries()) {
          setTimeout(() => mockSocketRef.current?.deliver(frame), 200 + index * 120);
        }
        return { commandId, submitted: true };
      }
      return { commandId, submitted: false };
    },
    [view],
  );

  const recordSent = useCallback(
    (
      sent: { readonly commandId: string; readonly submitted: boolean },
      commandText: string,
      source: CommandSource,
      recipient: { readonly agentId: string; readonly callsign: string } | null = null,
    ) => {
      setSentCommands((rows) => [
        ...rows,
        {
          commandId: sent.commandId,
          commandText,
          source,
          agentId: recipient?.agentId ?? null,
          callsign: recipient?.callsign ?? null,
          submitted: sent.submitted,
          noticeIndexAtSend: noticeCountRef.current,
          receiptIndexAtSend: receiptCountRef.current,
        },
      ]);
    },
    [],
  );

  const handleSendMessage = useCallback(
    (text: string) => {
      recordSent(dispatchSay(text), text, "text");
    },
    [dispatchSay, recordSent],
  );

  const latestDeliveryOf = useCallback(
    (match: (command: SentCommand) => boolean) => {
      const command = [...sentCommands].reverse().find(match);
      return command === undefined ? null : deriveDelivery(command, sideband.receipts, sideband.notices);
    },
    [sentCommands, sideband.receipts, sideband.notices],
  );
  const latestMapDelivery = useMemo(() => latestDeliveryOf((command) => command.source === "map"), [latestDeliveryOf]);
  const latestMessageDelivery = useMemo(
    () => latestDeliveryOf((command) => command.source !== "map"),
    [latestDeliveryOf],
  );
  const serverNotice = useServerNotice(sideband);

  const selectedAgent = useMemo(
    () => view?.agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [view, selectedAgentId],
  );

  // An unsent draft keeps its own recipient when another crew is inspected, so its cue starts there.
  const previewAgentId = mapDraft?.agentId ?? selectedAgentId;
  const mapPreviewFrom = useMemo(() => {
    if (previewAgentId === null || view === null) return null;
    const scene = buildSceneEntities(view, scenarioMap).agents.find((a) => a.id === previewAgentId);
    return scene ? { x: scene.position.x, z: scene.position.z } : null;
  }, [previewAgentId, view]);

  const mapPreviewTo = useMemo(() => {
    if (mapDraft === null) return null;
    return worldToScenePoint(mapDraft.cueTo, scenarioMap.worldMeters);
  }, [mapDraft]);

  // A pick started for one crew never lands on another.
  useEffect(() => {
    setMapAssignMode(false);
    setMapPickHint(null);
  }, [selectedAgentId]);

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
        worldMeters: scenarioMap.worldMeters,
      });
      if (draft === null) {
        setMapPickHint("Pick a point at least 25 m from the crew so the direction is clear.");
        setMapDraft(null);
        return;
      }
      setMapPickHint(null);
      setMapDraft(draft);
      setMapAssignMode(false);
    },
    [mapAssignMode, selectedAgent],
  );

  const handleDraftDirection = useCallback(
    (direction: CompassDirection, capMeters: number) => {
      if (selectedAgent === null) return;
      const from = agentWorldPoint(scenarioMap, selectedAgent.position);
      if (from === null) {
        setMapPickHint("Could not read the crew position.");
        return;
      }
      setMapAssignMode(false);
      setMapPickHint(null);
      setMapDraft(
        buildDirectionalDraft({
          agentId: selectedAgent.id as string,
          callsign: selectedAgent.callsign,
          from,
          direction,
          capMeters,
          worldMeters: scenarioMap.worldMeters,
        }),
      );
    },
    [selectedAgent],
  );

  const handleSendMapCommand = useCallback(() => {
    if (mapDraft === null) return;
    recordSent(dispatchSay(mapDraft.commandText), mapDraft.commandText, "map", {
      agentId: mapDraft.agentId,
      callsign: mapDraft.callsign,
    });
    setMapDraft(null);
  }, [dispatchSay, mapDraft, recordSent]);

  const handlePttBegin = useCallback(() => {
    speechStubRef.current.setRecording(true);
    protocolSocketRef.current?.sendCommand({ type: "ptt_begin" });
  }, []);

  const incidentEndedRef = useRef(false);
  incidentEndedRef.current = Boolean(view?.incidentEnd);

  const handlePttRelease = useCallback(
    (text: string) => {
      speechStubRef.current.setRecording(false);
      if (incidentEndedRef.current) {
        protocolSocketRef.current?.sendCommand({ type: "ptt_lost_focus", transcript: "" });
        return;
      }
      let sent: { commandId: string; submitted: boolean } | null = null;
      dispatchPttRelease({
        transcript: text,
        live:
          protocolSocketRef.current === null
            ? null
            : {
                sendCommand: (message) => {
                  // Live receipts carry server ids, so a voice command is never matched to one.
                  const submitted = protocolSocketRef.current?.sendCommand(message) ?? false;
                  sent = { commandId: `voice-${newCommandId()}`, submitted };
                },
              },
        mockMode: IS_MOCK_MODE,
        dispatchSay: (transcript) => {
          sent = dispatchSay(transcript);
        },
      });
      if (sent !== null) recordSent(sent, text, "voice");
    },
    [dispatchSay, recordSent],
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
    () => (view ? buildSceneEntities(view, scenarioMap, { phase }) : EMPTY_ENTITIES),
    [view, phase],
  );

  const activeRecipientCallsign = useMemo(() => {
    if (!view?.activeRecipientId) return null;
    return view.agents.find((agent) => agent.id === view.activeRecipientId)?.callsign ?? null;
  }, [view]);

  const callsignFor = useCallback(
    (agentId: string) => view?.agents.find((agent) => agent.id === agentId)?.callsign ?? agentId,
    [view],
  );
  const latestUrgent = view ? latestUrgentReport(view) : null;
  const urgentCallsign = latestUrgent === null ? null : callsignFor(latestUrgent.agentId as string);
  const urgentHistory = useMemo(
    () =>
      sideband.reports
        .filter((report) => report.urgent && report.sequence !== latestUrgent?.sequence)
        .reverse(),
    [sideband.reports, latestUrgent?.sequence],
  );

  const selectedCrew = useMemo(() => {
    if (selectedAgent === null || view === null) return null;
    const plan = view.agentPlans.find((candidate) => candidate.agentId === selectedAgent.id);
    return describeCrew(selectedAgent, plan, view.sites, view.simTimeMs as number);
  }, [selectedAgent, view]);

  const exampleCommand = useMemo(() => {
    const crew = view?.agents[0]?.callsign;
    const site = [...(view?.sites ?? [])].sort((a, b) => b.value - a.value)[0]?.name;
    return crew !== undefined && site !== undefined ? `\u201c${crew}, protect ${site}.\u201d` : null;
  }, [view?.agents, view?.sites]);

  const handlePrepareMessage = useCallback((callsign: string) => {
    setComposerPrefill((current) => ({ text: `${callsign}, `, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const audioSimulated = !GROK_LIVE;
  const audioSnapshot = GROK_LIVE ? liveAudioSnapshot(liveAudio) : speechSnapshot;
  const snapshotClock = useSnapshotClock(view, { recordedPlayback: IS_MOCK_MODE });

  const composerDisabled =
    connectionStatus !== "open" || Boolean(view?.incidentEnd) || (IS_MOCK_MODE && mockPlaybackEnded);
  const composerDisabledReason = view?.incidentEnd
    ? "The incident has ended"
    : IS_MOCK_MODE && mockPlaybackEnded
      ? "The recording has ended"
      : "Waiting for connection…";

  useEffect(() => {
    if (phase !== "live" || !focusLiveOnEnter.current) return;
    focusLiveOnEnter.current = false;
    liveHeadingRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== "live") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "m" && event.key !== "M") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
      ) {
        return;
      }
      // An unsent draft is reviewed or cleared first; a new pick never silently replaces it.
      if (composerDisabled || selectedAgentId === null || mapDraft !== null) return;
      event.preventDefault();
      setMapPanelOpen(true);
      setMapAssignMode((value) => !value);
      setMapPickHint(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, selectedAgentId, composerDisabled, mapDraft]);

  const mapCommandPanel = (
    <MapCommandPanel
      assignMode={mapAssignMode}
      onToggleAssignMode={() => {
        setMapAssignMode((value) => !value);
        setMapPickHint(null);
      }}
      selectedCallsign={selectedAgent?.callsign ?? null}
      selectedAgentId={selectedAgentId}
      crew={selectedCrew}
      onPrepareMessage={handlePrepareMessage}
      onDraftDirection={handleDraftDirection}
      draft={mapDraft}
      pickHint={mapPickHint}
      delivery={latestMapDelivery}
      disabled={composerDisabled}
      onSend={handleSendMapCommand}
      onCancelDraft={() => {
        setMapDraft(null);
        setMapPickHint(null);
      }}
      open={mapPanelOpen}
      onOpen={() => setMapPanelOpen(true)}
      onClose={() => {
        // Closing abandons any in-progress pick or unsent destination.
        setMapPanelOpen(false);
        setMapAssignMode(false);
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
        content={briefing}
        demoMode={demoMode}
        transportMode={TRANSPORT_MODE}
        voiceMode={GROK_LIVE ? "server" : "sample"}
        error={startError}
      />
    );
  }

  if (phase === "replay") {
    return (
      <ReplayView
        onExit={handleExitReplay}
        {...(replaySource === "incident" && replayRecording !== null
          ? { source: "incident" as const, recording: replayRecording }
          : { source: "illustrative" as const })}
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
          wallElapsedMs={snapshotClock.wallElapsedMs}
          connectionStatus={connectionStatus}
          speechSnapshot={audioSnapshot}
          audioSimulated={audioSimulated}
          snapshotAgeMs={connectionStatus === "open" ? snapshotClock.snapshotAgeMs : null}
        />
        <main className="app-layout__main" aria-labelledby="live-heading">
          <h1 id="live-heading" ref={liveHeadingRef} tabIndex={-1} className="sr-only">
            Live incident
          </h1>
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
            inspectedCallsign={selectedAgent?.callsign ?? null}
            onSendMessage={handleSendMessage}
            onPttBegin={handlePttBegin}
            onPttRelease={handlePttRelease}
            onPttCancel={handlePttCancel}
            composerDisabled={composerDisabled}
            composerDisabledReason={composerDisabledReason}
            demoMode={demoMode}
            speechSnapshot={speechSnapshot}
            audioSimulated={audioSimulated}
            prefill={composerPrefill}
            latestDelivery={latestMessageDelivery}
            notice={serverNotice.notice}
            onDismissNotice={serverNotice.dismiss}
            audioNotice={GROK_LIVE ? liveAudio.notice : null}
            onDismissAudioNotice={() => dispatchLiveAudio({ kind: "dismiss_notice" })}
            exampleCommand={exampleCommand}
            {...(grokStt === undefined ? {} : { grokStt })}
          />
        </main>
        <UrgentStrip
          report={latestUrgent}
          callsign={urgentCallsign}
          audioState={audioSnapshot.urgent ? audioSnapshot.state : "idle"}
          queuedUrgent={audioSnapshot.queuedUrgent}
          audioSimulated={audioSimulated}
          history={urgentHistory}
          callsignFor={callsignFor}
          onInspectCrew={setSelectedAgentId}
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
          view={view}
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
