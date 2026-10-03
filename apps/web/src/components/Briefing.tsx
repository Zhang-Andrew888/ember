import { briefingCallsigns, briefingIncidentLabel, briefingSites } from "../briefing/briefingInfo.js";
import { colors } from "../styles/colors.js";

export interface BriefingProps {
  readonly onStart: () => void;
  readonly starting: boolean;
}

/**
 * Briefing screen: title, fictional-incident label, sites/values,
 * callsigns, observation legend, mic check, "Start incident"
 * (docs/FRONTEND.md). The incident clock stays stopped until Start is
 * pressed - App.tsx only begins snapshot playback / calls the start
 * endpoint from onStart.
 */
export function Briefing({ onStart, starting }: BriefingProps) {
  return (
    <div className="briefing">
      <h1 className="briefing__title">EMBER LINE</h1>
      <p className="briefing__incident-label">{briefingIncidentLabel}</p>

      <section aria-labelledby="briefing-sites-heading">
        <h2 id="briefing-sites-heading">Sites to protect</h2>
        <ul className="briefing__sites">
          {briefingSites.map((site) => (
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
          {briefingCallsigns.map((callsign) => (
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
        <p className="briefing__mic-status">
          Voice push-to-talk is not connected in this build. Text input will be available once the incident
          starts.
        </p>
      </section>

      <button type="button" className="briefing__start" onClick={onStart} disabled={starting}>
        {starting ? "Starting…" : "Start incident"}
      </button>
    </div>
  );
}
