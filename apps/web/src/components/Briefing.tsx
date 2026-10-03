import { useCallback } from "react";
import { briefingIncidentLabel, type BriefingContent } from "../briefing/briefingInfo.js";
import { colors } from "../styles/colors.js";
import { MicCheck } from "./MicCheck.js";
import { createVoiceCapture } from "../net/voiceCapture.js";
import { DemoBanner } from "./DemoBanner.js";
import { TransportModeBadge } from "./TransportModeBadge.js";
import type { TransportMode } from "../net/transportMode.js";

export interface BriefingProps {
  readonly onStart: () => void;
  readonly starting: boolean;
  /** Why the last Start attempt failed, if it did; shown so Start never fails silently. */
  readonly error?: string | null;
  readonly content: BriefingContent;
  readonly demoMode: boolean;
  readonly transportMode: TransportMode;
}

/**
 * Briefing screen: title, fictional-incident label, sites/values,
 * callsigns, observation legend, mic check, "Start incident"
 * (docs/FRONTEND.md). The incident clock stays stopped until Start is
 * pressed - App.tsx only begins snapshot playback / calls the start
 * endpoint from onStart.
 */
export function Briefing({ onStart, starting, content, demoMode, transportMode, error = null }: BriefingProps) {
  const probeMic = useCallback(() => createVoiceCapture({ preferMicrophone: true }).probeMicrophone(), []);

  return (
    <div className="briefing">
      {demoMode ? <DemoBanner /> : null}
      <div className="briefing__header">
        <h1 className="briefing__title">EMBER LINE</h1>
        <TransportModeBadge mode={transportMode} />
      </div>
      <p className="briefing__incident-label">{briefingIncidentLabel}</p>

      <section aria-labelledby="briefing-sites-heading">
        <h2 id="briefing-sites-heading">Sites to protect</h2>
        <ul className="briefing__sites">
          {content.sites.map((site) => (
            <li key={site.name}>
              <span>{site.name}</span>
              <span className="briefing__site-value">value {site.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="briefing-callsigns-heading">
        <h2 id="briefing-callsigns-heading">Callsigns</h2>
        <ul className="briefing__callsigns">
          {content.callsigns.map((callsign) => (
            <li key={callsign}>{callsign}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="briefing-legend-heading">
        <h2 id="briefing-legend-heading">Observation legend</h2>
        <ul className="briefing__legend">
          <li>
            <span className="briefing__swatch" style={{ background: colors.observedFire }} /> Observed fire -
            confirmed burning
          </li>
          <li>
            <span className="briefing__swatch" style={{ background: colors.staleOutline }} /> Stale observation -
            may no longer be current
          </li>
          <li>
            <span className="briefing__swatch" style={{ background: colors.refuge }} /> Refuge - safe staging
            point
          </li>
        </ul>
      </section>

      <section aria-labelledby="briefing-mic-heading">
        <h2 id="briefing-mic-heading">Microphone check</h2>
        <MicCheck onProbe={probeMic} />
      </section>

      {error ? (
        <p role="alert" className="briefing__error">
          {error}
        </p>
      ) : null}
      <button type="button" className="briefing__start" onClick={onStart} disabled={starting}>
        {starting ? "Starting…" : "Start incident"}
      </button>
    </div>
  );
}
