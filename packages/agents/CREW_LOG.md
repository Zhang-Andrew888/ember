# Crew log (feat/crew)

Running log for the crew increments. Newest last.

## Setup
- pnpm 12.8.1 shim from corepack was broken in the container; used `corepack prepare pnpm@10.34.6 --activate`.
- PR review at start: #4 closed unmerged but superseded by merged #6 (same head); #8 is the web lane's. No crew PRs yet.

## Increment 1: typed crew roles (feat/crew-1-roles)
- Kinds engine / hand_crew / scout live in packages/agents (crew-internal). Wire role stays `protection_crew | scout`; a wire-level kind would need a contract change, not opened because nothing crosses the wire yet.
- The simulator gives every agent the same speed and work rate, so `navConfigFor` caps planning speed/work rate at the simulator's values and never lowers the buffer: capabilities can only make planning more conservative.
- Added `zod` 3.24.2 (same pin as domain/simulation) to packages/agents to validate attributes; lockfile updated.
- Kind only changes planning when passed explicitly; default controllers behave exactly as before.

## Increment 2: per-member state (feat/crew-2-member-state, depends on #10)
- `member-state.ts`: fatigue, injury risk, morale in [0,1], deterministic `advanceMemberState`, and `tightenNav` feeding feasibility. Outputs are never looser than the input (buffer grows, speed and work rate shrink); monotone in every factor (grid test).
- Injury risk never falls mid-incident; morale recovers only slowly. Standing at a refuge counts as rest.
- First version (no deadband, higher fatigue rates) changed apps/server session.test.ts timing (fewer crews crossed e-s-h). Not a bug, but I cannot edit that test, so: fatigue rates recalibrated to incident length and an onset deadband added (rested members plan exactly as before).
- Gotcha: apps/server tests consume `@ember/agents` from `dist`; run `pnpm build:libs` before probing server tests.
- Forecast hypotheses untouched: no dangerous hypothesis is ever dropped.
