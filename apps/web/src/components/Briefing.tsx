import { useCallback, useEffect, useRef } from "react";
import type { BriefingContent } from "../briefing/briefingInfo.js";
import { createVoiceCapture } from "../net/voiceCapture.js";
import type { TransportMode } from "../net/transportMode.js";
import { MicCheck } from "./MicCheck.js";
import { PublicIncidentPreview } from "./PublicIncidentPreview.js";
import { TransportModeBadge } from "./TransportModeBadge.js";

export interface BriefingProps {
  readonly onStart: () => void;
  readonly starting: boolean;
  readonly error?: string | null;
  readonly content: BriefingContent;
  readonly demoMode: boolean;
  readonly transportMode: TransportMode;
  /** "server": held speech is sent for recognition. "sample": holding plays a recorded sample line. */
  readonly voiceMode?: "server" | "sample";
}

/** A first message built from the briefing's own team and highest-value site. */
export function briefingExample(content: BriefingContent): string | null {
  const crew = content.callsigns[0];
  const site = [...content.sites].sort((a, b) => b.value - a.value)[0]?.name;
  return crew !== undefined && site !== undefined ? `\u201c${crew}, protect ${site}.\u201d` : null;
}

const numberFormat = new Intl.NumberFormat();

function BriefingFacts({ content }: { readonly content: BriefingContent }) {
  return (
    <div className="briefing__facts">
      <section aria-labelledby="briefing-sites-heading">
        <h2 id="briefing-sites-heading">Sites to protect</h2>
        <p className="briefing__note">Relative value compares sites with each other; it is not a dollar amount.</p>
        <div className="briefing__site-heading" aria-hidden="true"><span>Site</span><span>Relative value</span></div>
        {content.sites.length ? (
          <ul className="briefing__sites">
            {content.sites.map((site) => (
              <li className="briefing__site-row" key={site.name}>
                <span>{site.name}</span><span className="briefing__site-value" aria-label={`Relative value ${numberFormat.format(site.value)}`}>{numberFormat.format(site.value)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="briefing__empty">No sites listed.</p>}
      </section>
      <section aria-labelledby="briefing-team-heading">
        <h2 id="briefing-team-heading">Team</h2>
        {content.callsigns.length ? <ul className="briefing__callsigns">{content.callsigns.map((callsign) => <li key={callsign}>{callsign}</li>)}</ul> : <p className="briefing__empty">No team listed.</p>}
      </section>
      <section aria-labelledby="briefing-refuges-heading">
        <h2 id="briefing-refuges-heading">Refuges</h2>
        {content.refugeNames.length ? <ul className="briefing__refuges">{content.refugeNames.map((name) => <li key={name}>{name}</li>)}</ul> : <p className="briefing__empty">No refuges listed.</p>}
      </section>
    </div>
  );
}

export function Briefing({
  onStart,
  starting,
  content,
  demoMode,
  transportMode,
  voiceMode = "sample",
  error = null,
}: BriefingProps) {
  const probeMic = useCallback(() => createVoiceCapture({ preferMicrophone: true }).probeMicrophone(), []);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const example = briefingExample(content);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  return (
    <div className="briefing">
      <a className="briefing__skip" href="#briefing-main">Skip to briefing</a>
      <div className="briefing__shell">
        <header className="briefing__masthead">
          <span className="briefing__brand">Ember Line</span>
          <TransportModeBadge mode={transportMode} briefing />
        </header>
        <main id="briefing-main" className="briefing__grid" tabIndex={-1}>
          <div className="briefing__left">
            <div className="briefing__intro">
              <h1>Guide the crews. Keep a way out.</h1>
              <p>You have five minutes to protect {content.sites.length} sites. Send updates by text or voice; crews choose their routes and may turn back as conditions change.</p>
              {example !== null ? (
                <p className="briefing__example">
                  Start each message with the crew's name, for example: <q className="briefing__example-text">{example.slice(1, -1)}</q>
                </p>
              ) : null}
              <p className="briefing__fiction">A fictional training simulation. No real crews or places are involved.</p>
            </div>
            {content.preview ? <PublicIncidentPreview preview={content.preview} /> : null}
          </div>
          <div className="briefing__right">
            <BriefingFacts content={content} />
            <div className="briefing__actions">
              {error ? <p className="briefing__error" role="alert" tabIndex={-1} ref={errorRef}>Couldn’t start the incident. {error}</p> : null}
              <button type="button" className="briefing__start" onClick={onStart} disabled={starting} aria-busy={starting}>
                {starting ? "Starting…" : "Start incident"}
              </button>
              <div className="briefing__voice">
                <p className="briefing__voice-note">
                  Voice is optional. Text works throughout the incident.
                  {voiceMode === "server"
                    ? " Hold to talk sends your speech to the server for recognition. The check only asks for microphone permission; it does not test recognition."
                    : " In this mode, holding to talk sends a recorded sample line instead of your speech, the microphone is not used, and no reply audio is played."}
                  {voiceMode === "sample" && demoMode ? " Demo mode uses a scripted set of sample lines." : null}
                </p>
                {voiceMode === "server" ? <MicCheck onProbe={probeMic} /> : null}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
