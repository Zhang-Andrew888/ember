# Crew log (feat/crew)

Running log for the crew increments. Newest last.

## Setup
- pnpm 12.8.1 shim from corepack was broken in the container; used `corepack prepare pnpm@10.34.6 --activate`.
- PR review at start: #4 closed unmerged but superseded by merged #6 (same head); #8 is the web lane's. No crew PRs yet.

## Increment 1: typed crew roles (feat/crew-1-roles)
- Kinds engine / hand_crew / scout live in packages/agents (crew-internal). Wire role stays `protection_crew | scout`; a wire-level kind would need a contract change, not opened because nothing crosses the wire yet.
- The simulator gives every agent the same speed and work rate, so `navConfigFor` caps planning speed/work rate at the simulator's values and never lowers the buffer: capabilities can only make planning more conservative.
- Added `zod` 3.24.2 (same pin as domain/simulation) to packages/agents. Needed because pnpm resolves strictly (domain's zod is not importable here) and @ember/domain does not re-export `z`; domain cannot be edited by this lane. Lockfile updated.
- Kind only changes planning when passed explicitly; default controllers behave exactly as before.
- Review of #10 (rejected comment): added the dependency justification. Kept base `main` and the `[feat/crew]` title because the task instructions require them; spec-first concern (kinds not in docs) recorded for Andrew.

## Increment 2: per-member state (feat/crew-2-member-state, depends on #10)
- `member-state.ts`: fatigue, injury risk, morale in [0,1], deterministic `advanceMemberState`, and `tightenNav` feeding feasibility. Outputs are never looser than the input (buffer grows, speed and work rate shrink); monotone in every factor (grid test).
- Injury risk never falls mid-incident; morale recovers only slowly. Standing at a refuge counts as rest.
- First version (no deadband, higher fatigue rates) changed apps/server session.test.ts timing (fewer crews crossed e-s-h). Not a bug, but I cannot edit that test, so: fatigue rates recalibrated to incident length and an onset deadband added (rested members plan exactly as before).
- Gotcha: apps/server tests consume `@ember/agents` from `dist`; run `pnpm build:libs` before probing server tests.
- Forecast hypotheses untouched: no dangerous hypothesis is ever dropped.

## Increment 3: autonomy policy (feat/crew-3-autonomy, stacked on #11)
- `autonomy.ts`: pure `decideOrder` (accept/refuse) and `decideContinuation` (continue/withdraw) plus the announcement (callsign-first text, urgent for refusals and withdrawals, silent on accept).
- Refuse limits are gentler than withdraw limits (fatigue 0.8/0.92, injury 0.5/0.7, morale 0.25/0.1): a crew finishes its task but takes no new one.
- return/hold/avoid/resume are always accepted (they only restrict exposure). Unknown order kinds are refused.
- Survival reasons (route closed, certify failure, forecast unreliable) outrank member condition.
- Rising fatigue tightens certification first, so in practice the forecast reason fires slightly before the member withdraw limit; the member branch is covered by the pure tests.
- Added optional `memberState` to ControllerOptions (validated) so a crew can start already worn.

## Review round (17:2x UTC)
- #10 and #11 rejected by review. #10: process (waived later) plus not in plan; dependency note added. #11: cites SIMULATION.md line 90 "No injury meter". My reading: that is world state; crew-internal planning margin never enters it. Replied on #11; flagged for Andrew. If he disagrees, #11/#13 get closed, not reworked.
- Trimmed lockfile to the zod entry (newer pnpm had added unrelated `libc:` lines).
- Increments 4-7 branch from main, independent of #10/#11/#13.
