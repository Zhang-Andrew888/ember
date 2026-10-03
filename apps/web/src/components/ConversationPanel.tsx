import { useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import type { CoordinatorReportEntry } from "@ember/domain";
import { formatIncidentClock } from "../format/time.js";
import { createMockVoiceAdapter, type CaptureState } from "../net/mockVoiceAdapter.js";
import type { SpeechPlaybackSnapshot } from "../state/speechPlaybackStub.js";

export interface ConversationPanelProps {
  readonly reports: CoordinatorReportEntry[];
  readonly activeRecipientCallsign: string | null;
  readonly onSendMessage: (text: string) => void;
  /** Drives the routine (non-urgent) outgoing-acknowledgement indicator; urgent playback shows in UrgentStrip instead. */
  readonly speechSnapshot: SpeechPlaybackSnapshot;
}

/**
 * Right panel: conversation transcript, text input, push-to-talk
 * (docs/FRONTEND.md). Push-to-talk is a mock capture adapter (backlog
 * item 4) - real Grok Voice is Slice 5/out of scope and unreachable from
 * this sandbox anyway; text input stays the always-working fallback
 * regardless, and the status text says plainly that this is a demo
 * capture, not real speech recognition.
 */
export function ConversationPanel({
  reports,
  activeRecipientCallsign,
  onSendMessage,
  speechSnapshot,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const adapterRef = useRef(createMockVoiceAdapter());
  const latest = reports[reports.length - 1] ?? null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft("");
  };

  const startCapture = () => {
    adapterRef.current.start();
    setCaptureState("recording");
  };

  const commitCapture = () => {
    const result = adapterRef.current.commit();
    setCaptureState("idle");
    if (result) onSendMessage(result.text);
  };

  const cancelCapture = () => {
    adapterRef.current.cancel();
    setCaptureState("idle");
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    startCapture();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.code !== "Space" || event.repeat) return;
    event.preventDefault(); // suppress the native click-on-keyup-space activation
    startCapture();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.code !== "Space") return;
    event.preventDefault();
    commitCapture();
  };

  const showOutgoingAck = speechSnapshot.state !== "idle" && !speechSnapshot.urgent;

  return (
    <section className="conversation-panel" aria-label="Conversation">
      <div className="conversation-panel__recipient">
        {activeRecipientCallsign ? `Addressing: ${activeRecipientCallsign}` : "No recipient addressed yet"}
      </div>

      <ol className="conversation-panel__transcript" aria-label="Report transcript">
        {reports.map((report) => (
          <li key={report.sequence as number} className="conversation-panel__report">
            <span className="conversation-panel__report-time">{formatIncidentClock(report.simTimeMs)}</span>
            <span className="conversation-panel__report-agent">{report.agentId}</span>
            <span className="conversation-panel__report-text">{report.text}</span>
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="sr-only">
        {latest ? `${latest.agentId}: ${latest.text}` : ""}
      </div>

      <form className="conversation-panel__composer" onSubmit={handleSubmit}>
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <input
          id="composer-input"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message…"
          autoComplete="off"
        />
        <button type="submit" disabled={draft.trim().length === 0}>
          Send
        </button>
        <button
          type="button"
          aria-describedby="push-to-talk-status"
          aria-pressed={captureState === "recording"}
          className="conversation-panel__push-to-talk"
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
          Demo capture: hold to simulate a voice message (no real microphone or speech recognition).
        </span>
        <div aria-live="polite" className="conversation-panel__speech-ack">
          {showOutgoingAck ? `🔊 ${speechSnapshot.text}` : ""}
        </div>
      </form>
    </section>
  );
}
