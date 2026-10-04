import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import type { TranscriptLine } from "../conversation/transcript.js";
import type { NoticePresentation } from "../conversation/notices.js";
import { isNearBottom } from "../conversation/stickToBottom.js";
import { deliveryGuidance, deliveryLabel, type CommandDelivery } from "../command/commandDelivery.js";
import { formatIncidentClock } from "../format/time.js";
import { createBrowserVoiceCapture, type BrowserVoiceCapture } from "../net/browserVoiceCapture.js";
import { microphoneStartFailureMessage } from "../net/microphoneFailure.js";
import { GROK_CAPTURE_FAILURE_MESSAGE, settleGrokCapture } from "../net/settleGrokCapture.js";
import { createVoiceCapture, type VoiceCaptureAdapter } from "../net/voiceCapture.js";
import type { SpeechPlaybackSnapshot } from "../state/speechPlaybackStub.js";

export interface ComposerPrefill {
  readonly text: string;
  /** Changes on every request, so the same text can be prepared twice. */
  readonly nonce: number;
}

export interface ConversationPanelProps {
  readonly transcript: readonly TranscriptLine[];
  /** Recipient the server reports as currently addressed. */
  readonly activeRecipientCallsign: string | null;
  /** Crew selected for map inspection; never the recipient unless a message names it. */
  readonly inspectedCallsign?: string | null;
  readonly onSendMessage: (text: string) => void;
  readonly onPttBegin: () => void;
  readonly onPttRelease: (text: string) => void;
  readonly onPttCancel: () => void;
  readonly composerDisabled: boolean;
  /** Why the composer is disabled, shown as its placeholder. */
  readonly composerDisabledReason?: string;
  readonly demoMode: boolean;
  readonly speechSnapshot: SpeechPlaybackSnapshot;
  /** True when the audio indicator describes the timing stub rather than real playback. */
  readonly audioSimulated?: boolean;
  /** When set, push-to-talk records mic audio and transcribes via the server (xAI STT). */
  readonly grokStt?: (audio: Blob) => Promise<string | null>;
  readonly prefill?: ComposerPrefill | null;
  /** Delivery state of the latest typed or spoken message. */
  readonly latestDelivery?: CommandDelivery | null;
  readonly notice?: NoticePresentation | null;
  readonly onDismissNotice?: () => void;
  readonly audioNotice?: string | null;
  readonly onDismissAudioNotice?: () => void;
  /** A short, valid example shown until the first message is sent. */
  readonly exampleCommand?: string | null;
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

type CaptureState = "idle" | "requesting" | "recording" | "transcribing";

interface CaptureNotice {
  readonly tone: "info" | "error";
  readonly text: string;
}

const SESSION_ENDED_CAPTURE_NOTICE =
  "Voice message discarded: the incident ended or the connection dropped before it was sent.";

/**
 * Right panel: unified transcript, text input, push-to-talk (docs/FRONTEND.md).
 */
export function ConversationPanel({
  transcript,
  activeRecipientCallsign,
  inspectedCallsign = null,
  onSendMessage,
  onPttBegin,
  onPttRelease,
  onPttCancel,
  composerDisabled,
  composerDisabledReason = "Waiting for connection…",
  demoMode,
  speechSnapshot,
  audioSimulated = true,
  grokStt,
  prefill = null,
  latestDelivery = null,
  notice = null,
  onDismissNotice,
  audioNotice = null,
  onDismissAudioNotice,
  exampleCommand = null,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const [captureState, setCaptureStateValue] = useState<CaptureState>("idle");
  const captureStateRef = useRef<CaptureState>("idle");
  const [captureNotice, setCaptureNotice] = useState<CaptureNotice | null>(null);
  const browserCaptureRef = useRef<BrowserVoiceCapture | null>(null);
  const captureStartRef = useRef<Promise<void> | null>(null);
  /** Bumped whenever a capture is abandoned, so its late callbacks cannot send anything. */
  const generationRef = useRef(0);
  const disabledRef = useRef(composerDisabled);
  const callbacksRef = useRef({ onPttCancel, onPttRelease });
  callbacksRef.current = { onPttCancel, onPttRelease };
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const noticeId = useId();
  const adapterRef = useRef<VoiceCaptureAdapter>(
    createVoiceCapture(demoMode ? { transcripts: DEMO_TRANSCRIPTS } : {}),
  );
  const serverStt = grokStt !== undefined;

  const setCaptureState = (next: CaptureState) => {
    captureStateRef.current = next;
    setCaptureStateValue(next);
  };

  const transcriptRef = useRef<HTMLOListElement>(null);
  // Follow new lines unless the reader scrolled up to read earlier ones.
  const followingRef = useRef(true);
  const seenLengthRef = useRef(transcript.length);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    const list = transcriptRef.current;
    const added = transcript.length - seenLengthRef.current;
    seenLengthRef.current = transcript.length;
    if (list === null) return;
    if (followingRef.current) {
      list.scrollTop = list.scrollHeight;
    } else if (added > 0) {
      setUnseenCount((count) => count + added);
    }
  }, [transcript.length]);

  const jumpToLatest = () => {
    const list = transcriptRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
    followingRef.current = true;
    setUnseenCount(0);
  };

  useEffect(() => {
    if (prefill === null) return;
    setDraft(prefill.text);
    const input = inputRef.current;
    if (input !== null) {
      input.focus();
      input.setSelectionRange(prefill.text.length, prefill.text.length);
    }
  }, [prefill]);

  const releaseBrowserCapture = (capture: BrowserVoiceCapture, pendingStart: Promise<void> | null) => {
    if (browserCaptureRef.current === capture) browserCaptureRef.current = null;
    if (captureStartRef.current === pendingStart) captureStartRef.current = null;
  };

  /** Stops any capture for a session that can no longer accept it; PTT is settled at most once. */
  const abandonCapture = (reason: string | null) => {
    const state = captureStateRef.current;
    if (state === "idle") return;
    generationRef.current += 1;
    const capture = browserCaptureRef.current;
    const pendingStart = captureStartRef.current;
    capture?.cancel();
    adapterRef.current.cancel();
    setCaptureState("idle");
    // A transcribing capture settles PTT itself through its own (now stale) callbacks.
    if (state !== "transcribing") callbacksRef.current.onPttCancel();
    if (reason !== null) setCaptureNotice({ tone: "error", text: reason });
    if (capture !== null) {
      void Promise.resolve(pendingStart)
        .catch(() => undefined)
        .finally(() => releaseBrowserCapture(capture, pendingStart));
    }
  };

  useEffect(() => {
    disabledRef.current = composerDisabled;
    if (composerDisabled) abandonCapture(SESSION_ENDED_CAPTURE_NOTICE);
  }, [composerDisabled]);

  useEffect(
    () => () => {
      disabledRef.current = true;
      abandonCapture(null);
    },
    [],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || composerDisabled) return;
    onSendMessage(text);
    setDraft("");
  };

  const startCapture = () => {
    if (composerDisabled || captureStateRef.current !== "idle") return;
    setCaptureNotice(null);
    onPttBegin();
    if (!serverStt) {
      adapterRef.current.start();
      setCaptureState("recording");
      return;
    }
    const generation = generationRef.current;
    const capture = createBrowserVoiceCapture();
    browserCaptureRef.current = capture;
    setCaptureState("requesting");
    const pending = capture.start();
    captureStartRef.current = pending;
    pending.then(
      () => {
        if (generation !== generationRef.current || browserCaptureRef.current !== capture) return;
        if (captureStateRef.current === "requesting") setCaptureState("recording");
      },
      (error: unknown) => {
        if (generation !== generationRef.current || browserCaptureRef.current !== capture) return;
        releaseBrowserCapture(capture, pending);
        setCaptureState("idle");
        setCaptureNotice({ tone: "error", text: microphoneStartFailureMessage(error) });
        onPttCancel();
      },
    );
  };

  const commitSampleCapture = () => {
    setCaptureState("idle");
    const result = adapterRef.current.commit();
    if (result) {
      onPttRelease(result.text);
      setCaptureNotice({ tone: "info", text: `Sent sample voice line: \u201c${result.text}\u201d` });
    } else {
      onPttCancel();
      setCaptureNotice({ tone: "info", text: "Hold the button a little longer to send a sample line." });
    }
  };

  const commitCapture = () => {
    const state = captureStateRef.current;
    if (state !== "recording" && state !== "requesting") return;
    if (!serverStt || grokStt === undefined) {
      commitSampleCapture();
      return;
    }
    const capture = browserCaptureRef.current;
    if (capture === null) {
      setCaptureState("idle");
      onPttCancel();
      return;
    }
    const pendingStart = captureStartRef.current;
    const generation = generationRef.current;
    setCaptureState("transcribing");
    void (async () => {
      let closed = false;
      const cancel = () => {
        if (closed) return;
        closed = true;
        callbacksRef.current.onPttCancel();
      };
      const current = () => generation === generationRef.current && !disabledRef.current;
      try {
        const result = await settleGrokCapture({
          stop: () => capture.stop(),
          transcribe: grokStt,
          onRelease(text) {
            if (closed) return;
            if (!current()) {
              cancel();
              return;
            }
            closed = true;
            callbacksRef.current.onPttRelease(text);
            setCaptureNotice({ tone: "info", text: `Sent by voice: \u201c${text}\u201d` });
          },
          onCancel: cancel,
        });
        if (generation === generationRef.current) {
          if (result.status === "failed") setCaptureNotice({ tone: "error", text: GROK_CAPTURE_FAILURE_MESSAGE });
          if (result.status === "cancelled") {
            setCaptureNotice({ tone: "info", text: "Nothing was recorded. Hold the button while you speak." });
          }
          if (result.status === "released" && !current()) {
            setCaptureNotice({ tone: "error", text: SESSION_ENDED_CAPTURE_NOTICE });
          }
        }
        if (result.status !== "released") {
          // Permission may still be pending; hold this capture until tracks are stopped.
          await pendingStart?.catch(() => undefined);
        }
      } catch {
        if (generation === generationRef.current) {
          setCaptureNotice({ tone: "error", text: GROK_CAPTURE_FAILURE_MESSAGE });
        }
        cancel();
        await pendingStart?.catch(() => undefined);
      } finally {
        releaseBrowserCapture(capture, pendingStart);
        if (generation === generationRef.current && captureStateRef.current === "transcribing") {
          setCaptureState("idle");
        }
      }
    })();
  };

  const cancelCapture = () => {
    const state = captureStateRef.current;
    if (state !== "recording" && state !== "requesting") return;
    abandonCapture(null);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    startCapture();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.code === "Escape") {
      if (captureStateRef.current === "recording" || captureStateRef.current === "requesting") {
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

  const showOutgoingAck = speechSnapshot.state !== "idle" && !speechSnapshot.urgent && speechSnapshot.text !== null;
  const announced = [...transcript].reverse().find((line) => !line.urgent) ?? null;
  const hasCoordinatorLine = transcript.some((line) => line.kind === "coordinator");

  const pttLabel: Record<CaptureState, string> = {
    idle: serverStt ? "Push to talk" : "Hold for sample voice line",
    requesting: "Waiting for microphone…",
    recording: "Recording… release to send",
    transcribing: "Transcribing…",
  };

  const micStatus = serverStt
    ? captureState === "requesting"
      ? "Waiting for microphone permission. Release or press Esc to cancel."
      : captureState === "recording"
        ? "Recording. Release to send; Esc cancels."
        : captureState === "transcribing"
          ? "Transcribing your message on the server…"
          : "Voice: hold to record from your microphone; release to send. Speech is transcribed on the server."
    : `Sample voice only: there is no speech recognition in this mode. Holding and releasing sends the canned line \u201c${adapterRef.current.peekTranscript()}\u201d. Type to give your own orders.`;

  const recipientCue = activeRecipientCallsign
    ? `Conversation recipient: ${activeRecipientCallsign}`
    : "No recipient addressed yet: name a crew to address it";

  return (
    <section className="conversation-panel" aria-label="Conversation">
      <div className="conversation-panel__recipient">
        <span>{recipientCue}</span>
        {inspectedCallsign !== null && inspectedCallsign !== activeRecipientCallsign ? (
          <span className="conversation-panel__inspecting">
            Inspecting {inspectedCallsign} on the map does not address it.
          </span>
        ) : null}
      </div>

      <div className="conversation-panel__history">
        <ol
          ref={transcriptRef}
          className="conversation-panel__transcript"
          aria-label="Conversation transcript"
          tabIndex={0}
          onScroll={(event) => {
            followingRef.current = isNearBottom(event.currentTarget);
            if (followingRef.current) setUnseenCount(0);
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
              {line.kind === "rejection" ? <span className="conversation-panel__tag">Objective rejected</span> : null}
            </li>
          ))}
        </ol>
        {unseenCount > 0 ? (
          <button type="button" className="conversation-panel__jump" onClick={jumpToLatest}>
            {unseenCount === 1 ? "1 new message" : `${unseenCount} new messages`}: jump to latest
          </button>
        ) : null}
      </div>
      {/* Urgent reports are announced once by the urgent strip, so they are not repeated here. */}
      <div aria-live="polite" className="sr-only">
        {announced ? `${announced.speaker}: ${announced.text}` : ""}
      </div>

      {notice !== null ? (
        <div className={`conversation-panel__notice conversation-panel__notice--${notice.tone}`} role="status">
          <span>{notice.text}</span>
          <span className="conversation-panel__notice-actions">
            {notice.restorableText !== null ? (
              <button type="button" onClick={() => setDraft(notice.restorableText ?? "")}>
                Put back in message box
              </button>
            ) : null}
            {onDismissNotice ? (
              <button type="button" onClick={onDismissNotice} aria-label="Dismiss server notice">
                Dismiss
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      {latestDelivery !== null ? (
        <div
          className={`conversation-panel__delivery conversation-panel__delivery--${latestDelivery.phase}`}
          role="status"
        >
          <span className="conversation-panel__delivery-subject">
            Your last {latestDelivery.source === "voice" ? "voice " : ""}message: {latestDelivery.commandText}
          </span>
          <span className="conversation-panel__delivery-phase">{deliveryLabel(latestDelivery.phase)}</span>
          {deliveryGuidance(latestDelivery.phase) ? <span>{deliveryGuidance(latestDelivery.phase)}</span> : null}
          {latestDelivery.phase === "not_submitted" ? (
            <button type="button" onClick={() => setDraft(latestDelivery.commandText)}>
              Put back in message box
            </button>
          ) : null}
        </div>
      ) : null}

      <form className="conversation-panel__composer" onSubmit={handleSubmit}>
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <input
          id="composer-input"
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={composerDisabled ? composerDisabledReason : "Type a message…"}
          aria-describedby={exampleCommand !== null && !hasCoordinatorLine ? `${statusId}-example` : undefined}
          autoComplete="off"
          disabled={composerDisabled}
        />
        {exampleCommand !== null && !hasCoordinatorLine ? (
          <p id={`${statusId}-example`} className="conversation-panel__example">
            Name the crew first, for example: {exampleCommand}
          </p>
        ) : null}
        <button type="submit" disabled={composerDisabled || draft.trim().length === 0}>
          Send
        </button>
        <button
          type="button"
          aria-describedby={captureNotice === null ? statusId : `${statusId} ${noticeId}`}
          aria-pressed={captureState === "recording" || captureState === "requesting"}
          aria-disabled={captureState === "transcribing" || undefined}
          className="conversation-panel__push-to-talk"
          data-capture={captureState}
          disabled={composerDisabled}
          onPointerDown={handlePointerDown}
          onPointerUp={commitCapture}
          onPointerCancel={cancelCapture}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={cancelCapture}
        >
          {pttLabel[captureState]}
        </button>
        <span id={statusId} className="conversation-panel__mic-status" aria-live="polite">
          {micStatus}
        </span>
        {captureNotice !== null ? (
          <p
            id={noticeId}
            role="status"
            className={`conversation-panel__capture-notice conversation-panel__capture-notice--${captureNotice.tone}`}
          >
            {captureNotice.text}
          </p>
        ) : null}
        {audioNotice !== null ? (
          <p className="conversation-panel__capture-notice conversation-panel__capture-notice--error" role="status">
            {audioNotice}{" "}
            {onDismissAudioNotice ? (
              <button type="button" className="conversation-panel__inline-button" onClick={onDismissAudioNotice}>
                Dismiss
              </button>
            ) : null}
          </p>
        ) : null}
        <div aria-live="polite" className="conversation-panel__speech-ack">
          {showOutgoingAck ? `${audioSimulated ? "Simulated speech" : "Speaking"}: ${speechSnapshot.text}` : ""}
          {speechSnapshot.queuedUrgent ? " Urgent audio queued." : ""}
          {speechSnapshot.queuedRoutineCount > 0 ? ` ${speechSnapshot.queuedRoutineCount} routine queued.` : ""}
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
