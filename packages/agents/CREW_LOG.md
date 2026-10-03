# Crew log (feat/crew)

Running log for the crew increments. Newest last. (Increments 1-3 live on their own stacked branches and add their own sections; expect a trivial add/add merge here.)

## Increment 4: knowledge (feat/crew-4-knowledge, from main, independent of #10/#11/#13)
- `packages/knowledge`: `contradictions()` (clear overturned by later fire; equal-time conflict, order independent, deduped), `contradictedCells()`, `staleBeliefs(now)`, `ageMs`, `isSuperseded`, and `selectRelay` with `DEFAULT_RELAY_POLICY`.
- Recovery is conservative: a contradicted cell stays closed, an older clear never revives it, and relayed old clears that arrive late are history not contradictions.
- Relay rules: only observations the recipient lacks, still the source's current word on something, lapsed clear-only sightings dropped after 120 s, fire never lapses, original source and observed time preserved, stale ones flagged not refreshed. Only observations travel: never forecasts, plans or world parameters.
- Regression `packages/agents/src/isolation.test.ts`: a scout observation held only by the coordinator leaves the crew's knowledge hash and committed plans identical to a run without it, plus a positive control that an explicit relay does change the hash. Increment 7 strengthens this over many seeds.
- Not done: wiring `contradictedCells` into forecast rebuild triggers (the forecast package owns its own `needsRebuild`; crews consume projections, not stores).
Running log for the crew increments. Newest last.

## Setup
- pnpm 12.8.1 shim from corepack was broken in the container; used `corepack prepare pnpm@10.34.6 --activate`.
- PR review at start: #4 closed unmerged but superseded by merged #6 (same head); #8 is the web lane's. No crew PRs yet.

## Increment 1: typed roles and capabilities (feat/crew-1-roles), reworked after review
- Review rejected the first version (engine / hand_crew kinds, fatigue, carrying capacity are not in the docs; new zod dependency not justified). Reworked to the subset the spec supports: per-role typed `speedMps` and `workRate` equal to the documented defaults (SIMULATION.md; NAVIGATION_AGENTS.md "the crew's own work rate"), over the existing wire roles. No new dependency, no behaviour change at defaults.
- The full first version is preserved on branch `feat/crew-1-roles-full` in case Andrew amends the spec to add crew kinds.
- Kinds engine / hand_crew, fatigue and carrying capacity need a spec change first (`docs/**` is human-authored); not resubmitted.
Running log for the crew increments. Newest last. (Each branch adds its own section; expect trivial add/add merges on this file.)

## Increment 3, reworked (feat/crew-3-autonomy-policy, from main)
- #13 was rejected: it keyed refusals/withdrawals to fatigue, injury risk and morale (contested vs SIMULATION.md line 90) and so depended on #10/#11. Reworked from main with none of that.
- `autonomy.ts`: pure `decideOrder` (accept/refuse) and `decideContinuation` (continue/withdraw) plus the announcement text. Triggers are only ones the spec already defines: direct observation closing the route, certifier failure, unreliable forecast, unsupported order kind, planner infeasibility.
- Behaviour-preserving: the controller now asks the policy, with the same reason codes and the same announcement wording as before. All pre-existing controller tests pass unchanged.
- Safety check caught in review of my own cut: a crew on its normal return phase must still withdraw when its route closes, so only withdrawing/retreating crews are exempt.
- return/hold/avoid/resume are always accepted: they only reduce exposure. Survival reasons are ordered: observation, certifier, forecast reliability.

## Increment 7: property test and tick-budget guard (feat/crew-7-property-bench, stacked on #15)
- `scenarios.testkit.ts` (test support, not exported): seeded PRNG (mulberry32), `variation(n)` derived only from n, and `runWithScout`. Moved out of the increment 4 test so both tests share it.
- Property: over 16 variations (fire spot, spread rate, seed) the crew's knowledge hash and committed plans are identical with and without the scout's coordinator-only observations. Not vacuous: asserts the scout produced coordinator-only observations each time, the crew never holds scout-sourced observations, no physical `entry_blocked` (a separate channel), and that crews commit plans in at least half the variations. Positive control: an explicit relay changes the hash.
- Tick budget: `tick-budget.test.ts` runs the 4-agent team for 600 simulated seconds and asserts p95 < 200 ms and median < 50 ms, plus a 3 s cap on the cold start.
- FINDING: measured locally, median ~0.06 ms, p99 ~80 ms, but the first tick of the synchronous four-controller harness is ~760 ms (cold forecast builds). That exceeds the 200 ms budget if forecasts ran inline; docs say forecast work is asynchronous, which is why the guard bounds it separately instead of at 200 ms. Worth confirming the server really runs it off the tick.
