import { useState } from "react";
import type { FormEvent } from "react";
import type { CoordinatorReportEntry } from "@ember/domain";
import { formatIncidentClock } from "../format/time.js";

export interface ConversationPanelProps {
  readonly reports: CoordinatorReportEntry[];
  readonly activeRecipientCallsign: string | null;
  readonly onSendMessage: (text: string) => void;
}

/**
 * Right panel: conversation transcript, text input, push-to-talk
 * (docs/FRONTEND.md). Voice capture (Grok push-to-talk) is Slice 5 scope
 * and not wired up here; the microphone control is a real, accessible,
 * clearly-disabled control rather than something that looks functional
 * but silently does nothing - text input is always the working fallback.
 */
export function ConversationPanel({ reports, activeRecipientCallsign, onSendMessage }: ConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const latest = reports[reports.length - 1] ?? null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft("");
  };

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
          disabled
          className="conversation-panel__push-to-talk"
        >
          Push to talk
        </button>
        <span id="push-to-talk-status" className="conversation-panel__mic-status">
          Microphone not connected in this build — use text.
        </span>
      </form>
    </section>
  );
}
