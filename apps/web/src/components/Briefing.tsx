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
}

const numberFormat = new Intl.NumberFormat();

function BriefingFacts({ content }: { readonly content: BriefingContent }) {
  return (
    <div className="briefing__facts">
      <section aria-labelledby="briefing-sites-heading">
        <h2 id="briefing-sites-heading">Sites to protect</h2>
        <div className="briefing__site-heading" aria-hidden="true"><span></span><span>Relative value</span></div>
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

export function Briefing({ onStart, starting, content, demoMode, transportMode, error = null }: BriefingProps) {
  const probeMic = useCallback(() => createVoiceCapture({ preferMicrophone: true }).probeMicrophone(), []);
  const errorRef = useRef<HTMLParagraphElement>(null);
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
            </div>
            {content.preview ? <PublicIncidentPreview preview={content.preview} /> : null}
          </div>
          <div className="briefing__right">
            <BriefingFacts content={content} />
            <div className="briefing__actions">
              <div>
                <p className="briefing__voice-note">Voice is optional. Text works throughout the incident.</p>
                <MicCheck onProbe={probeMic} />
                {demoMode ? <p className="briefing__demo-note">Demo voice uses simulated speech.</p> : null}
              </div>
              {error ? <p className="briefing__error" role="alert" tabIndex={-1} ref={errorRef}>Couldn’t start the incident. {error}</p> : null}
              <button type="button" className="briefing__start" onClick={onStart} disabled={starting} aria-busy={starting}>
                {starting ? "Starting…" : "Start incident"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
