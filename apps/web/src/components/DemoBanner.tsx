/** Shown when `?demo=1` — scripted mock replies and presentation labels. */
export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      Demo mode: push-to-talk uses simulated transcripts; try “status”, a named crew order, or “invalid objective”.
    </div>
  );
}
