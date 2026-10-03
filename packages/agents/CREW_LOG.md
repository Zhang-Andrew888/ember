# Crew log (feat/crew)

Running log for the crew increments. Newest last. (Increments 1-3 live on their own stacked branches and add their own sections; expect a trivial add/add merge here.)

## Increment 4: knowledge (feat/crew-4-knowledge, from main, independent of #10/#11/#13)
- `packages/knowledge`: `contradictions()` (clear overturned by later fire; equal-time conflict, order independent, deduped), `contradictedCells()`, `staleBeliefs(now)`, `ageMs`, `isSuperseded`, and `selectRelay` with `DEFAULT_RELAY_POLICY`.
- Recovery is conservative: a contradicted cell stays closed, an older clear never revives it, and relayed old clears that arrive late are history not contradictions.
- Relay rules: only observations the recipient lacks, still the source's current word on something, lapsed clear-only sightings dropped after 120 s, fire never lapses, original source and observed time preserved, stale ones flagged not refreshed. Only observations travel: never forecasts, plans or world parameters.
- Regression `packages/agents/src/isolation.test.ts`: a scout observation held only by the coordinator leaves the crew's knowledge hash and committed plans identical to a run without it, plus a positive control that an explicit relay does change the hash. Increment 7 strengthens this over many seeds.
- Not done: wiring `contradictedCells` into forecast rebuild triggers (the forecast package owns its own `needsRebuild`; crews consume projections, not stores).
