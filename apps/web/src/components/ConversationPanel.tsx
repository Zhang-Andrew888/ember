import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import type { TranscriptLine } from "../conversation/transcript.js";
import { isNearBottom } from "../conversation/stickToBottom.js";
import { FireLineHelp } from "./FireLineHelp.js";
import { formatIncidentClock } from "../format/time.js";
import { createBrowserVoiceCapture, type BrowserVoiceCapture } from "../net/browserVoiceCapture.js";
import { GROK_CAPTURE_FAILURE_MESSAGE, settleGrokCapture } from "../net/settleGrokCapture.js";
import { createVoiceCapture, type MicPermissionState, type VoiceCaptureAdapter } from "../net/voiceCapture.js";
import type { SpeechPlaybackSnapshot } from "../state/speechPlaybackStub.js";

export interface ConversationPanelProps {
  readonly transcript: readonly TranscriptLine[];
  readonly activeRecipientCallsign: string | null;
  readonly onSendMessage: (text: string) => void;
  readonly onPttBegin: () => void;
  readonly onPttRelease: (text: string) => void;
  readonly onPttCancel: () => void;
  readonly composerDisabled: boolean;
  readonly demoMode: boolean;
  readonly speechSnapshot: SpeechPlaybackSnapshot;
  /** When set, push-to-talk records mic audio and transcribes via the server (xAI STT). */
  readonly grokStt?: (audio: Blob) => Promise<string | null>;
}

const LINE_CLASS: Record<TranscriptLine["kind"], string> = {
  agent_report: "conversation-panel__report",
  coordinator: "conversation-panel__line conversation-panel__line--coordinator",
  control: "conversation-panel__line conversation-panel__line--control",
  system: "conversation-panel__line conversation-panel__line--system",
  command_outcome: "conversation-panel__line conversation-panel__line--outcome",
  clarification: "conversation-panel__line conversation-panel__line--clarification",
  rejection: "conversation-panel__line conversation-panel__line--rejection",
};

/**
 * Right panel: unified transcript, text input, push-to-talk (docs/FRONTEND.md).
 */
export function ConversationPanel({
  transcript,
  activeRecipientCallsign,
  onSendMessage,
  onPttBegin,
  onPttRelease,
  onPttCancel,
  composerDisabled,
  demoMode,
  speechSnapshot,
  grokStt,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const [captureState, setCaptureState] = useState<"idle" | "recording">("idle");
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const browserCaptureRef = useRef<BrowserVoiceCapture | null>(null);
  const captureStartRef = useRef<Promise<void> | null>(null);
  const adapterRef = useRef<VoiceCaptureAdapter>(
    createVoiceCapture(
      demoMode
        ? { preferMicrophone: false, transcripts: DEMO_TRANSCRIPTS }
        : { preferMicrophone: true },
    ),
  );
  const latest = transcript[transcript.length - 1] ?? null;
  const transcriptRef = useRef<HTMLOListElement>(null);
  // Follow new lines unless the reader scrolled up to read earlier ones.
  const followingRef = useRef(true);

  useEffect(() => {
    const list = transcriptRef.current;
    if (list !== null && followingRef.current) list.scrollTop = list.scrollHeight;
  }, [transcript.length]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || composerDisabled) return;
    onSendMessage(text);
    setDraft("");
  };

  const releaseBrowserCapture = (
    capture: BrowserVoiceCapture,
    pendingStart: Promise<void> | null,
  ) => {
    if (browserCaptureRef.current === capture) browserCaptureRef.current = null;
    if (captureStartRef.current === pendingStart) captureStartRef.current = null;
  };

  const startCapture = () => {
    if (composerDisabled) return;
    setCaptureNotice(null);
    onPttBegin();
    if (grokStt !== undefined) {
      const capture = createBrowserVoiceCapture();
      browserCaptureRef.current = capture;
      const pending = capture.start();
      captureStartRef.current = pending;
      void pending.catch(() => {
        if (browserCaptureRef.current !== capture) return;
        releaseBrowserCapture(capture, pending);
        setCaptureState("idle");
        onPttCancel();
      });
    } else {
      adapterRef.current.start();
    }
    setCaptureState("recording");
  };

  const commitCapture = () => {
    if (captureState !== "recording") return;
    setCaptureState("idle");
    if (grokStt !== undefined && browserCaptureRef.current !== null) {
      const capture = browserCaptureRef.current;
      const pendingStart = captureStartRef.current;
      void (async () => {
        let closed = false;
        const cancel = () => {
          if (closed) return;
          closed = true;
          onPttCancel();
        };
        try {
          const result = await settleGrokCapture({
            stop: () => capture.stop(),
            transcribe: grokStt,
            onRelease(text) {
              if (closed) return;
              closed = true;
              setCaptureNotice(null);
              onPttRelease(text);
            },
            onCancel: cancel,
          });
          if (result.status === "failed") setCaptureNotice(GROK_CAPTURE_FAILURE_MESSAGE);
          if (result.status !== "released") {
            // Permission may still be pending; hold this capture until tracks are stopped.
            await pendingStart?.catch(() => undefined);
          }
          releaseBrowserCapture(capture, pendingStart);
        } catch {
          setCaptureNotice(GROK_CAPTURE_FAILURE_MESSAGE);
          cancel();
          await pendingStart?.catch(() => undefined);
          releaseBrowserCapture(capture, pendingStart);
        }
      })();
      return;
    }
    const result = adapterRef.current.commit();
    if (result) onPttRelease(result.text);
    else onPttCancel();
  };

  const cancelCapture = () => {
    if (captureState === "recording") {
      const capture = browserCaptureRef.current;
      const pendingStart = captureStartRef.current;
      capture?.cancel();
      adapterRef.current.cancel();
      setCaptureState("idle");
      onPttCancel();
      void Promise.resolve(pendingStart)
        .catch(() => undefined)
        .finally(() => {
          if (capture !== null) releaseBrowserCapture(capture, pendingStart);
        });
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    startCapture();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.code === "Escape") {
      if (captureState === "recording") {
        event.preventDefault();
        cancelCapture();
      }
      return;
    }
    if (event.code !== "Space" || event.repeat) return;
    event.preventDefault();
    startCapture();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.code !== "Space") return;
    event.preventDefault();
    commitCapture();
  };

  const showOutgoingAck = speechSnapshot.state !== "idle" && !speechSnapshot.urgent;
  const micState: MicPermissionState = adapterRef.current.micPermission;

  return (
    <section className="conversation-panel" aria-label="Conversation">
      <div className="conversation-panel__recipient">
        {activeRecipientCallsign ? `Addressing: ${activeRecipientCallsign}` : "No recipient addressed yet"}
      </div>

      <ol
        ref={transcriptRef}
        className="conversation-panel__transcript"
        aria-label="Conversation transcript"
        onScroll={(event) => {
          followingRef.current = isNearBottom(event.currentTarget);
        }}
      >
        {transcript.map((line) => (
          <li key={line.id} className={LINE_CLASS[line.kind]}>
            <span className="conversation-panel__report-time">{formatIncidentClock(line.simTimeMs)}</span>
            <span className="conversation-panel__report-agent">{line.speaker}</span>
            <span className="conversation-panel__report-text">{line.text}</span>
            {line.kind === "clarification" ? (
              <span className="conversation-panel__tag">Clarification required</span>
            ) : null}
            {line.kind === "rejection" ? (
              <span className="conversation-panel__tag">Objective rejected</span>
            ) : null}
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="sr-only">
        {latest ? `${latest.speaker}: ${latest.text}` : ""}
      </div>

      <FireLineHelp />

      <form className="conversation-panel__composer" onSubmit={handleSubmit}>
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <input
          id="composer-input"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={composerDisabled ? "Waiting for connection…" : "Type a message…"}
          autoComplete="off"
          disabled={composerDisabled}
        />
        <button type="submit" disabled={composerDisabled || draft.trim().length === 0}>
          Send
        </button>
        <button
          type="button"
          aria-describedby={captureNotice === null ? "push-to-talk-status" : "push-to-talk-status push-to-talk-failure"}
          aria-pressed={captureState === "recording"}
          className="conversation-panel__push-to-talk"
          disabled={composerDisabled}
          onPointerDown={handlePointerDown}
          onPointerUp={commitCapture}
          onPointerCancel={cancelCapture}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={cancelCapture}
        >
          {captureState === "recording" ? "Recording… release to send" : "Push to talk"}
        </button>
        <span id="push-to-talk-status" className="conversation-panel__mic-status">
          {grokStt !== undefined
            ? "Grok STT: hold to record from your microphone; release to transcribe on the server."
            : demoMode
              ? "Demo capture: hold for a canned voice line (no live speech recognition)."
              : `Capture: ${micState}. Hold to send; release commits.`}
        </span>
        {captureNotice !== null ? (
          <p id="push-to-talk-failure" role="status" className="conversation-panel__capture-notice">
            {captureNotice}
          </p>
        ) : null}
        <div aria-live="polite" className="conversation-panel__speech-ack">
          {showOutgoingAck ? `🔊 ${speechSnapshot.text}` : ""}
          {speechSnapshot.queuedUrgent ? ", urgent audio queued" : ""}
          {speechSnapshot.queuedRoutineCount > 0 ? `, ${speechSnapshot.queuedRoutineCount} routine queued` : ""}
        </div>
      </form>
    </section>
  );
}

const DEMO_TRANSCRIPTS: readonly string[] = [
  "Crew 2, status report.",
  "Crew 1, hold position and await instructions.",
  "Crew 1, protect Ridge Cabins.",
];
