# Lane/Sim


Branch: `lane/sim` (mirrored on `claude/sim-lane-agent-implementation-w9svb5`). Every commit below passed
`pnpm typecheck`, `pnpm lint` and `pnpm test` before it was pushed. Nothing touched `apps/web`, `packages/domain`,
`docs/**`, `CHANGELOG.md` or `.github/workflows/**`.

A message partway through asked for an `apps/web` backlog. It was meant for the web lane and was withdrawn; no
`apps/web` file was changed or reverted because of it.

## Slice status

| Slice | Exit gate | Evidence |
|---|---|---|
| 1 | Same input log reproduces the same result | `packages/replay/src/record-io.test.ts`, `packages/simulation/src/incident.test.ts` |
| 1 | Five-minute wall limit maps to incident time | `packages/simulation/src/movement.test.ts` (clock), `apps/server/src/runner.test.ts` |
| 1 | No render or provider delay changes the clock | `apps/server/src/runner.test.ts` (cadence, stalls, giant late pump) |
| 2 | Coordinator-only observation cannot affect a crew plan | `packages/simulation/src/incident.test.ts`, `packages/agents/src/controller.test.ts`, `apps/server/src/session.test.ts` |
| 2 | Stale "clear" is not current clearance | `packages/knowledge/src/store.test.ts`, `packages/forecast/src/forecast.test.ts` |
| 2 | Empty/contradicted ensemble admits no protection work | `packages/forecast/src/forecast.test.ts`, `packages/navigation/src/navigation.test.ts` |
| 2 | Replay alone reveals the full fire | `packages/replay/src/reveal.test.ts` |
| 3 | Infeasible one-member case rejected; shorter work may pass | `packages/navigation/src/navigation.test.ts` |
| 3 | Changing forecast causes autonomous departure | `packages/agents/src/controller.test.ts` ("surprise" end to end) |
| 3 | No-feasible-return escapes (retreat/stranded) | `packages/navigation`, `packages/agents` tests |
| 4 | Crews never share the single-capacity corridor | `apps/server/src/session.test.ts`, `packages/simulation/src/movement.test.ts` |
| 4 | Unsafe yield rejected | `packages/navigation/src/reservations.test.ts` |
| 4 | Scout observations stay with the coordinator until relayed | `apps/server/src/session.test.ts`, `packages/simulation/src/incident.test.ts` |
| 4 | Surviving scout alone does not keep the incident running | `packages/simulation/src/world.test.ts` |

Skipped by instruction: Slice 0 items needing xAI keys, a microphone or real map data; the Slice 1 web start screen
and debrief (web lane). The scenario is the authored synthetic graph in `packages/simulation/src/scenario.ts`, not the
real Oakland extract.

## Commits

1. `sim: add shared seeded model` - rng streams, road index, terrain, fire spread.
2. `knowledge: add per-agent observation store` - relay, staleness, conflict rules.
3. `sim: add seeded incident core` - fixed step world, input log, run records, projections.
4. `server: runner; replay: persist and verify run records`.
5. `forecast: ensembles` - 24 members, fitting, contradiction, 2x/4x/8x rebuild.
6. `replay: reveal full fire`.
7. `navigation: mission search, certification, reversal, retreat`.
8. `perf: incremental fitting, cached rollouts, backward return table`.
9. `agents: crew controller` - autonomous withdrawal, retreat, objectives.
10. `navigation: reservations` - priorities, guard gap, verified yielding.
11. `agents/server: reservations wired in, scout, team session`.
12. `communication: gateway, scripted interpreter, audio scheduler, push-to-talk, replies; server conversation bridge`
    (Slice 5, no-provider).
13. `replay/server: metrics, bundles, scripted coordinator policy, three-variant evaluation harness, failure injection` (Slice 7). Contract-gap issue filed as #3 (existing #1/#2 are the web lane's).

## Design decisions and deviations (read these)

- **Dependencies.** `zod` 3.24.2 added to `@ember/simulation` (same version as domain; scenario input is a boundary).
  Workspace-only edges added: simulation -> knowledge; forecast/navigation/agents/replay -> simulation (pure `./model`
  subpath for shared fire/road code, plus `Incident` for tests/replay); server -> knowledge/forecast/navigation.
- **Cell observations use a pseudo edge id `"grid"`** with the flat 64x64 index as `cellIndex`, because the domain
  `ObservedField` can only name road cells. See contract issues below.
- **`SimulationAPI` is not implemented as a class.** `evaluateMission` needs navigation, which depends on simulation;
  `replay(DomainEvent[])` cannot rebuild truth. The working equivalents are `Incident`, `replayRecord` and
  `revealFire`.
- **Conservative planning.** Forecast rollouts record ignition at the start of a 5 s step. With the full prior the
  planner is cautious: crews often find no admissible mission once fire is near. That is reported as `idle` with a
  reason, never hidden.
- **Calibration is not done.** Spread, damage and timing constants are the documented defaults; the synthetic fire
  patch location was chosen so initial missions are admissible. No headline win rate was tuned.
- A planning bug found and fixed on the way: a late-evidence `evalDirty` storm made agents re-plan on every step
  (9x slowdown); only burning/burned evidence triggers it now.

## Slice 5 (no provider) and Slice 7 (replay, policy, failure injection)

- `packages/communication`: intent envelope schema, public-name matching, `ScriptedInterpreter` (deterministic stand-in
  for the model), `CommandGateway` (persistent addressed recipient resolved in input order, clarification, evidence
  resolved only from received reports, agent reports never become observations, unsupported claims change nothing,
  idempotent command ids, 5 s "still interpreting" / 10 s failure, incident-end rejection), `AudioScheduler`
  (urgent-over-routine, recording suspends playback, unready urgent audio blocks routine, relevance check, coalescing,
  flush, one end announcement), `PushToTalk`, replies in plain or radio phrasing built from committed decisions.
  Covered: communication cases 1-15 from docs/VALIDATION.md except real microphone/provider behaviour.
- `apps/server`: `IncidentRunner` (monotonic clock), `IncidentSession` (incident + controllers + reservations),
  `ConversationBridge`, `ScriptedCoordinatorPolicy` (v2), evaluation harness (`runVariant`, `runEvaluation`), offline
  CLIs (`evaluate-cli.ts`, `sensitivity-cli.ts`), failure injection (sensor blackout, relay delay, relay drop).
- `packages/replay`: run records, bundles, `BundleReplayReader`, `revealFire`, run metrics.
- `apps/server` also has a validated wire protocol (`protocol.ts`), `SessionHub`, `LiveRun` (monotonic due-time loop)
  and a loopback WebSocket server (`ws-server.ts`) with a real-socket test; a run-length test scans every outbound
  message for the seed, private parameters and truth fire state.
- `packages/simulation/src/fuzz.test.ts`: random orders for six seeds; physical invariants (single-capacity
  exclusivity, work caps, monotone damage, permanent closures, lost agents frozen) and exact replay hold.
- `packages/simulation/src/validate.ts`: `validateScenario` (referential integrity, connectivity, ignition outside refuge areas;
  `Incident` refuses invalid scenarios) and `scenarioGates` (the SIMULATION.md geometry acceptance constraints as executable
  checks). The synthetic scenario passes all five; use them to test a real map crop once one is extracted.
- Not done: the real Grok adapter (needs provider access / Slice 0); the two-minute
  presentation and screenshots (web lane); agent-loss injection.

## Evaluation results (actual numbers, 4-core Linux container, Node 22.22.0, scenario hash 9c5ecd71...)

Files: `apps/server/evaluation-results/` (`heldout-20-seeds.json`, `dev-5-seeds.json`, `showcase-seed.json`,
`prior-sensitivity-exploratory.json`). Policy: `scripted-relay` v2. Seeds: `heldout-01..20`, with every fourth seed
forcing an earlier-than-prior wind shift (280 s) and every fourth-plus-one a wider spread rate (1.55).

| 20 held-out seeds | Dispatch baseline | Forecast, no scout | Ember Line |
|---|---|---|---|
| Mean protection work delivered | 802.5 | 634.8 | 633.3 |
| Mean sites protected and standing (of 3) | 1.45 | 1.00 | 1.00 |
| Mean sites destroyed | 1.2 | 1.3 | 1.3 |
| Crews lost (total over 20 runs) | 11 | 0 | 0 |
| Missions started / returns / interrupted by end / superseded / lost before return | 186 / 99 / 26 / 108 / 7 | 74 / 74 / 0 / 71 / 0 | 75 / 75 / 0 / 72 / 0 |
| Stranded seconds (total) | 758 | 0 | 0 |
| Runs ended by | resolved 14, expired 5, all crews lost 1 | expired 10, resolved 10 | expired 10, resolved 10 |

Reading these honestly:

- The no-forecast baseline delivers more work and saves more sites, but it loses crews (11 over 20 runs, 7 before
  returning) and spends time stranded; forecast planning lost none. That is a safety/productivity trade, not a win for
  either side. Final health here is an endpoint measure and runs end at different times.
- **The scout shows no measurable benefit on this scenario** (633 vs 635 work; same sites). Three reasons visible in
  traces: all three crews independently pick the same best site at t=0 (spec: no shared knowledge), finishing it at
  about 509 s and then finding no admissible mission once the fire nears; the scout's information-value ranking mostly
  picks points near the corridor, far from the fire front; and the scripted policy only relays, it never allocates.
  No claim of a navigation benefit from scouting can be made from this data.
- Prior width is not the limiting factor: widening, narrowing or matching the prior to the true sampling ranges gave
  600-648 work (`prior-sensitivity-exploratory.json`, 5 dev seeds, exploratory).
- Performance (all variants, held-out): authoritative step mean 0.12-0.15 ms, p95 1 ms, max 18 ms (target p95 < 20 ms
  met); controller work p95 22-32 ms per simulated second; replanning (ticks that produced a plan) p50 7-12 ms and
  p95 218-228 ms for forecast variants (target p95 < 500 ms met). Contradiction rebuilds can take 1-4 s in this
  single-threaded harness; the design runs them asynchronously, so a real server must run forecasts off the step loop.
- Representative failures (15 in the held-out report): dispatch lost crews on heldout-02, 06, 10, 14, 15, 18 and 19
  and was stranded on 01, 08, 13 and 19; the forecast variants never lost a crew but needed a best-effort retreat on
  heldout-07 (no scout) and 01, 15, 17 (Ember Line); see `failures` in the JSON.
- These numbers were produced after the last behaviour change (commits applied before relays within a step); the
  earlier run, before it, differed only slightly (dispatch 10 crews lost, 173 missions).

## Calibration and scenario notes

- The first synthetic graph funnelled every crew through one corridor, so crews 2 and 3 never worked. A second road
  (Refuge South to Community Lodge) was added to the authored graph; tests that assumed only two ways home were updated.
  This is an authored-scenario change, not a result-tuning change, and it is recorded in the commit message.
- Planning is conservative by design (start-of-step ignition, 30 s buffer, wide prior); `idle: no_feasible_mission`
  is reported with a reason, never hidden.
- Not implemented from the docs: the scout using relayed crew missions or deadlines for relevance; objective kinds
  "avoid corridor" (contract gap, issue #3); real-map extraction.

## Later hardening (after the slice gates were met)

- Fixed a stranded-halt bug: an agent halted mid-edge with no way forward is now re-planned instead of idling.
- Added property tests: backward ReturnTable against forward search, the fast fire-spread path against a reference
  implementation of the documented formula, and capping of a large supported ensemble keeps the extremes.
- `validateScenario` / `scenarioGates` (packages/simulation) check references, duplicates, connectivity, ignition
  placement and the five documented geometry gates; `Incident` refuses an invalid scenario.
- `apps/server/src/check-scenario-cli.ts` runs those checks on a scenario JSON
  (`npx tsx src/check-scenario-cli.ts <file>`); the synthetic scenario passes all five gates, the placeholder
  `scenarios/scenario-v1.placeholder.json` correctly fails the schema (its fields are still PENDING).

- Fixed: `ScriptedInterpreter` threw on a callsign containing regex metacharacters (now escaped); the WebSocket
  server now caps messages at 64 KiB (closes with 1009) and absorbs socket errors.
- Fixed: `KnowledgeStore` site and cell beliefs no longer depend on arrival order for equal-time observations;
  `revealFire` always ends on a frame at the recorded final time; the hub passed simulated time to
  `PushToTalk.disconnect` while begin/release use wall time (now wall time throughout).
- Added: a test that no per-agent projection carries private parameters.
- Known gap: the server does not apply backpressure to a client that stops reading its socket (the `ws` library
  buffers without limit). Acceptable for the loopback-only demo server; not handled.

## CI notes

Two pushed commits (`fb01dc1`, `d67effe`) showed a red `Test` job even though every test passed: vitest exited 1
on an unhandled "Timeout calling onTaskUpdate" because one long synchronous test file starved the worker's RPC
channel on the slower runner. Fixed in `3591b00` (one test per variant/seed, macrotask yield between heavy server
tests). `Typecheck` and `Lint` were green throughout.

## Review of own diff

Bugs found and fixed after the fact: relay `receivedAt` used the pre-step time; replans fired every step on any new
cell evidence (9x slowdown); emergency/return planning used the approach class's reservation view; certification
ignored an agent held past its planned departure; the metrics counted a mission replaced by a return order as never
returned; unreachable `SimulationAPI` claims. Dead code removed. Gaps remaining: the speed-up work to forecasts relies
on the incremental-fit assumption that evidence is append-only per source (out-of-order evidence falls back to a full
rebuild, tested); the `ScriptedInterpreter` is a keyword parser, not a language model.

## Final summary (sim lane)

State: `lane/sim` and `claude/sim-lane-agent-implementation-w9svb5` are identical and pushed. Last full local run:
typecheck and lint clean, 27 test files, 268 tests passing. CI was green on every pushed commit checked, up to the
push-to-talk fix and the log updates; the last code commit (replay step constant, no behavior change) was still
running when this was written.

Done: Slices 1 to 4 exit gates that do not need real map data or provider keys; Slice 5 conversation layer with the
scripted interpreter and recording speech sink; Slice 7 replay, scripted coordinator policy, evaluation harness and
failure injection; scenario validation and executable geometry gates with a checker CLI.

Late review fixes (each with a test that failed first): callsign regex escaping, WebSocket message cap, arrival-order
independence of knowledge beliefs, replay final frame, push-to-talk clock mix-up.

Not done / honest limits:
- Slice 0 items needing xAI keys, a microphone or real map data; the synthetic scenario stands in for a real crop.
- The scout showed no benefit on the synthetic scenario, and the dispatch baseline does more protection work than the
  forecast planner at the cost of lost crews. Both are reported as measured, not tuned away.
- No backpressure for a slow WebSocket client (loopback demo server only).
- The `ScriptedInterpreter` is a keyword parser, not a language model.
- `apps/web` was not touched; a web-lane message sent here by mistake was withdrawn and ignored.

# Lane/Web


Autonomous overnight session. No one is available to answer questions;
decisions below were made unilaterally and are recorded here for review.

**Live instruction mid-session:** user told this session to push small
focused commits directly to `lane/web` (not the `claude/web-scene-threejs-83jkrv`
branch this cloud session was originally started on) for the rest of the
overnight run. Commit `766df9d` onward goes to `lane/web`.

## 2026-10-03 07:0x UTC (03:0x ET) - increment 1

**What changed**

- Added `apps/web/src/map/scenarioMap.ts` + `positions.ts` (+ tests): a local,
  placeholder node/edge coordinate layout keyed by the placeholder IDs used
  in `tests/fixtures/coordinator-view.fixture.ts`, with pure functions to
  resolve an `AgentPosition` or fire-cell index to a scene-space point.
  `packages/domain` only carries topological positions (edge+distance or
  node id), never coordinates, so the web lane needs its own geometry until
  the real OSM extract lands in Slice 0. This is local, disposable layout
  data - not a domain contract - so it lives entirely in `apps/web`.
- Added `apps/web/src/net/CoordinatorViewClient.ts`: a WebSocket client
  abstraction (`WebSocketLike` is an injectable interface, not the real
  `WebSocket` type) that validates every incoming frame against the
  `CoordinatorView` Zod schema from `@ember/domain` and drops anything that
  doesn't parse, rather than trusting the payload. Keeps the highest-
  sequence view seen (`state/viewReducer.ts`) and auto-reconnects with a
  fixed delay on unexpected close.
- Added `apps/web/src/net/mockIncidentSocket.ts`: a small, hand-authored
  script of 3 `CoordinatorView` snapshots (the fixture, plus two authored
  follow-ups) played back over the `WebSocketLike` interface. This is
  explicitly sanctioned by docs/IMPLEMENTATION_PLAN.md Slice 1 ("Use
  authored commands in the harness temporarily") - it is NOT a
  reimplementation of fire/movement simulation, which stays out of
  apps/web per AGENTS.md lane ownership. Playback only starts when
  `.start()` is called, modeling "clock stopped until Start screen".
- Added `apps/web/src/net/incidentRestClient.ts`: best-effort
  `POST /incidents/:id/start` per docs/ARCHITECTURE.md transport contract.
- Added `apps/web/src/format/time.ts` and `format/reports.ts`: pure
  formatters/selectors (incident clock, remaining wall time, urgent-report
  selection, site protection status) kept separate from components so they
  have direct Vitest coverage.
- Added `apps/web/src/state/useCoordinatorView.ts`: `useSyncExternalStore`
  hook so CoordinatorViewClient updates reach React without putting
  simulation state inside per-frame reconciliation.
- Added `apps/web/src/components/scene/projectToScreen.ts`: pure world-to-
  screen-pixel projection for DOM labels over the canvas (no `@react-three/drei`
  dependency added - avoided per "no new dependency without justification";
  used three's own `Camera.project()` instead).

**Decision: tsconfig path mapping for `@ember/domain`**

`tsc -p apps/web/tsconfig.json --noEmit` failed before this commit: several
new test files import `fixtureCoordinatorView` from
`tests/fixtures/coordinator-view.fixture.ts`, which itself imports
`@ember/domain`. `tests/` has no `node_modules` (it isn't a pnpm workspace
package), so plain Node resolution of that nested import fails under
apps/web's tsconfig even though `tests/tsconfig.json` and Vitest both
resolve it fine. Fixed by adding the same `paths` redirect
`tests/tsconfig.json` already uses (`"@ember/domain": ["../../packages/domain/src/index.ts"]`)
to `apps/web/tsconfig.json`. No files outside `apps/web` were touched; this
is a tsconfig-only fix, consistent with the existing convention. Also added
`"types": ["vite/client"]` to apps/web/tsconfig.json, needed for
`import.meta.env` typing used by the connection setup landing in the next
increment.

**No contract changes needed.** `CoordinatorView` and friends cover
everything the web lane needs so far; no GitHub issue opened.

**Status:** typecheck, lint, test all green repo-wide (`pnpm typecheck`,
`pnpm lint`, `pnpm test`). 67 tests passing, 8 files.

**Blocked:** nothing.

**Next:** build the actual React Three Fiber scene (terrain, roads,
instanced fire cells, site/refuge/agent markers, bounded orthographic
camera, DOM label overlay) and the surrounding accessible DOM UI (briefing,
top bar, conversation panel, urgent strip, agent rail, end overlay), then
wire it all together in `main.tsx`/`App.tsx`.

## 2026-10-03 07:1x UTC (03:1x ET) - increment 2

**What changed:** commit `81c530a` - the Three.js/R3F scene itself
(Terrain, Roads, FireCells, SiteMarkers/RefugeMarkers, AgentMarkers,
CameraControls, SceneLabelLayer, SceneLegend, SceneView), built on top of
`sceneEntities.ts` (CoordinatorView resolved against the local scenario
map; unit tested).

**Decision: no `@react-three/drei`.** docs/FRONTEND.md suggests "a small
selection of Drei camera/label helpers", but it isn't in `apps/web`'s
dependencies yet and AGENTS.md asks for a comment justifying any new
direct dependency. Used three's own `OrbitControls` from
`three/examples/jsm/controls/OrbitControls.js` (ships inside the already-
installed `three` package, typed via the already-installed `@types/three`)
for bounded camera orbit/zoom, and a hand-rolled `requestAnimationFrame`
DOM label layer (`SceneLabelLayer.tsx` + `projectToScreen.ts`, the latter
unit tested) instead of drei's `<Html>`. If a future increment wants
drei's richer helpers, that's a one-line dependency add + lockfile update,
not a blocker.

**Decision: pan is bounded by zoom/distance limits, not a hard rectangular
clamp.** `CameraControls.tsx` sets `minDistance`/`maxDistance` and a
polar-angle range so the camera can't flip below the horizon or zoom
arbitrarily far, satisfying "bounded pan and zoom" in spirit. A pixel-exact
pan boundary would need custom clamping logic on top of OrbitControls;
deferred as a follow-up rather than adding untested geometry under time
pressure overnight.

**Status:** typecheck, lint, test green (`pnpm typecheck`, `pnpm lint`,
`pnpm test`; 60 web-lane tests). `vite build` not yet run end-to-end -
`main.tsx` is still the original stub, so nothing imports the new scene
code yet and a build right now would tree-shake all of it away. Will run
a real `vite build` once `App.tsx`/`main.tsx` wire everything together
(next increment).

**Blocked:** nothing.

**Next:** surrounding DOM UI (briefing screen, top bar, conversation
panel + urgent strip, agent rail, end overlay), then wire into
`main.tsx`/`App.tsx` and verify a real production build.

## 2026-10-03 07:1x-07:2x UTC (03:1x-03:2x ET) - increment 3

**What changed:** commit `2d774d6` - the rest of the docs/FRONTEND.md
layout (Briefing, TopBar, ConversationPanel, UrgentStrip, AgentRail,
EndOverlay) and `App.tsx`/`main.tsx` wiring everything (net + state + map +
format + scene modules) into one app. Added `CameraControls.focusOn` so
selecting an agent card re-centers the camera once without fighting the
user's own pan on every snapshot.

**Decision: push-to-talk is a real disabled control, not a fake one.**
Grok voice integration is Slice 5 and explicitly out of this session's
scope (task brief: Slice 1 scene + Slice 6 Three.js experience only). The
button is present, accessible, and clearly labeled as not connected, per
docs/FRONTEND.md's own allowance for "a visible microphone permission/error
state". Text input is the always-working path.

**Decision: briefing content is a small authored module
(`briefing/briefingInfo.ts`), not derived from any live data.** The real
`POST /incidents` briefing endpoint doesn't exist (apps/server is still a
stub). Authored to list exactly the sites/callsigns the mock harness's
snapshots use, so the briefing screen can't promise an agent or site that
never shows up live.

**Decision: composer send is a best-effort POST, silently dropped in mock
mode.** There's no backend listening in mock mode, so `onSendMessage` only
calls `fetch` when `VITE_INCIDENT_REST_BASE_URL` is configured; no invented
receipts or fabricated acceptance either way.

**Status:** `pnpm typecheck && pnpm lint && pnpm test` all green (76
tests). A real `vite build` is running now to validate the production
bundle end-to-end (resolving `three/examples/jsm/...`, the cross-directory
fixture import, etc.) - result recorded in the next log entry.

**Blocked:** nothing yet; waiting on the build check above.

**Next:** confirm the production build, then this is a complete,
demoable Slice 1 + Slice 6 increment on `lane/web`.

## 2026-10-03 07:2x-07:3x UTC (03:2x-03:3x ET) - increment 4: real browser verification + bug fixes

**`vite build` (production) is pathologically slow in this sandbox** -
even a trivial React-only `main.tsx` with no app code took >60s and was
still short of finishing; the non-trivial app ran 3+ minutes with steadily
climbing memory (2.8GB -> 4GB) before I killed it. `vite dev` starts in
270ms by contrast, so this is specific to the production bundle/minify
step (Rollup or esbuild's minifier) under this sandbox's CPU constraints,
not a code defect - and it isn't something CI actually runs (`ci.yml`'s
three jobs are `pnpm typecheck`, `pnpm build:libs && pnpm lint`, and
`pnpm build:libs && pnpm test`; none of them call `vite build`). Decision:
stop trying to force a production build here: it isn't a CI gate, and
repeatedly retrying a multi-minute, multi-GB build in a resource-
constrained sandbox isn't worth it for a step nothing downstream depends
on. Noting this as a real open question for whoever next runs a true
production build (local machine or a less constrained CI runner) rather
than silently declaring it "fine."

**Used `vite dev` + Playwright (both pre-installed in this environment)
instead to actually render the app**, since typecheck/lint/test can't
catch rendering-only bugs. This caught two real defects that would have
otherwise gone to `lane/web` unverified:

1. **Label overlap**: an agent co-located with a refuge/site (e.g. Crew 2
   idle at Refuge West) projected to the same screen point as that node's
   label, rendering as illegible overlapping text. Fixed with a new, unit-
   tested `stackLabels.ts` (generic screen-space collision avoidance,
   approximate text-width heuristic, pushes later labels straight up).
   This is exactly the kind of thing the Slice 6 exit gate calls out
   ("all product-critical states remain legible") - and it's the sort of
   bug no amount of type-checking would find.
2. **Markers sinking into terrain**: `Terrain.tsx`'s procedural elevation
   (up to ±24) was never reconciled against the fixed Y heights used for
   roads/sites/agents/fire-cells (2-6), so depending on map position,
   markers and fire cells were partially or fully buried in terrain bumps
   - fire cells were invisible in the screenshot entirely. Fixed by
   scaling terrain amplitude down to a genuinely decorative ~±2.4 and
   raising every marker's Y with an explicit clearance-margin comment.

Both fixes are commit `f2f612a`, pushed to `lane/web`.
Before/after screenshots aren't committed to the repo (this is a code
session, not a design-asset one) but were visually confirmed during this
session: overlapping "Crew 2"/"Refuge West" and "Crew 1"/"Ridge Cabins"
text became two cleanly stacked labels each; fire cells that were
invisible became visible orange (fresh) and desaturated-grey (stale) boxes
along their roads.

**Opened `Contract change: CoordinatorView has no sanitized route/mission-
plan field`** (issue #1, labeled `contract`, not merged/acted on - that's
Andrew's call per AGENTS.md). docs/FRONTEND.md and the Slice 6 exit gate
both call for route/approach-return emphasis and "explains a route change
without exposing unknown fire," but `CoordinatorView`/`CoordinatorAgentView`
carry no route or mission-plan reference at all, and the fixture doesn't
either - this is a genuine schema gap, not something fixable from
`apps/web`. Left a concrete suggested shape in the issue but deferred the
actual sanitization-rule judgment call (what a route reveals about hidden
fire) to whoever owns that, since it's a simulation/knowledge-lane
question, not a web-lane one. The scene renders fully against the current
schema otherwise; this is the one Slice 6 exit-gate clause ("route
emphasis") that cannot be met until the contract changes.

**Status:** CI on `lane/web` has been green on every push this session
(verified via the GitHub Actions API: runs for `766df9d`, `81c530a`,
`e794b4e`, `2d774d6`, `f7e04b8`, `f2f612a` are all `conclusion: success`).
`pnpm typecheck && pnpm lint && pnpm test` green locally throughout (64
web-lane tests after the latest increment - `stackLabels.test.ts` added,
no tests removed; the earlier "76" count included `packages/domain`'s own
suite run via the root `pnpm test`, not a regression).

**Blocked:** nothing.

**Next:** keep working the Slice 6 exit gate as far as it can go against
the current fixture/mock data; watch for the next check-in or user
message.

## 2026-10-03 07:3x UTC (03:3x ET) - increment 5: closing out the Slice 6 exit gate

Systematic pass against the exact exit-gate text in
docs/IMPLEMENTATION_PLAN.md ("terrain composition, crew/site models,
observation/forecast layers, route emphasis, camera following, stale
information styling, accessible controls, urgent strip, briefing, and
debrief" / "legible at the target viewport and reduced-motion setting").
Three more real issues found and fixed, each verified live via Playwright,
each committed separately:

1. **`f2f612a`** *(already logged above, repeating for the consolidated
   checklist)* - label overlap, markers sinking into terrain.
2. **`bd7a788`** - "Animate transitions over 250 ms and honor reduced-
   motion preferences" was unmet: `CameraControls.focusOn` snapped
   instantly always. Added a 250ms easeOutCubic tween, skipped (instant)
   under reduced motion. Left `reset()` as OrbitControls' own instant,
   full-fidelity reset rather than also tweening it - deliberate scope
   boundary, not an oversight (see that commit for why).
3. **`7dd95ee`** - two issues: site protection status was color-only on
   the marker (violates "Do not convey ... safe/unsafe ... by color
   alone"), fixed by adding the status as text to the site's label; and a
   genuine continuity bug in the authored mock snapshots themselves (the
   3rd snapshot silently dropped the 2nd's site observation since each
   snapshot is replayed independently, not diffed) - Ridge Cabins'
   status was flickering back to "unobserved" after the crew had already
   started work. Both only visible by actually watching the mock play
   through multiple snapshots, not from a single screenshot.
4. **`0a7ed98`** - "Observed burned/active cells, with timestamps in
   inspection" was unmet: fire cells had no inspection interaction.
   Added click-to-inspect via `instancedMesh`'s `event.instanceId`
   (standard R3F pattern) showing edge/cell/state/last-observed-time.
5. **`89054f3`** - checked the smaller 1024x720 target viewport
   explicitly (docs/VALIDATION.md names it) for the first time this
   session, not just 1440x900. Found a label (Refuge South) rendering
   underneath the legend's fixed corner panel at that viewport's default
   camera framing - same underlying failure class as the first label-
   overlap bug, just against a static UI element instead of another
   label. Generalized `resolveLabelCollisions` to accept reserved UI
   boxes; the legend and cell-inspection panel now participate.

**Exit-gate self-assessment, against the literal text, as of `89054f3`:**

| Clause | Status |
|---|---|
| Terrain composition | Met |
| Crew/site models | Met |
| Observation layer | Met (click-to-inspect timestamps included) |
| Forecast layer | **Not met - no data.** `CoordinatorView` has no forecast field at all (issue #2, contract change opened). Nothing to render. |
| Route emphasis | **Not met - no data.** `CoordinatorView` has no route/mission-plan field (issue #1, contract change opened). |
| Camera following | Met, as a snap-to-and-tween on selection (not continuous dynamic tracking - see `bd7a788`'s commit message for the scope call) |
| Stale information styling | Met (fire cells desaturated + distinct from live flame; site labels say "(stale)" in text, not just opacity) |
| Accessible controls | Met (real DOM controls throughout; `role="alert"`/`role="status"`/`aria-live="polite"` regions; reduced-motion respected; color-alone audited and fixed where found) |
| Urgent strip | Met |
| Briefing | Met |
| Debrief (EndOverlay) | Met |
| Legible at 1440x900 and 1024x720 | Met (both viewports checked live; no horizontal overflow, no overlapping/hidden-behind-UI text) |
| "Map explains a route change without exposing unknown fire" | **Not met** - same root cause as route emphasis; there is no route to explain yet |
| "Meet measured rendering targets" | **Not measured.** This sandbox's headless Chromium runs software WebGL (no GPU), so any FPS number captured here would be meaningless as a performance claim, and `vite build`'s own pathological slowness (see increment 4) made even reasoning about bundle size weigh-ins unreliable. Needs a real machine - not fabricating a number to fill this row. |

Everything achievable against the current fixture and domain schema is
done and verified live, not just typechecked. The two genuinely blocked
items (route emphasis, forecast layer) both have contract-change issues
open (#1, #2) with concrete suggested shapes, and nothing in `apps/web`
can close them without that schema landing first.

**Status:** CI green on every push this session (12 pushes, all
`conclusion: success` per the GitHub Actions API - verified after each
one, not just assumed). `pnpm typecheck && pnpm lint && pnpm test` green
locally throughout; 68 web-lane tests as of `89054f3`.

**Blocked:** route emphasis and forecast layer, on issues #1 and #2
respectively (Andrew's call, per AGENTS.md's contract-change process).

**Next:** nothing further is achievable against the current fixture
without those contract changes. Will keep watching for new instructions;
otherwise this is a stable, green, fully live-verified stopping point.

## 2026-10-03 07:4x UTC (03:4x ET) - cross-session message mix-up

A message arrived telling this session to continue a large apps/web
backlog (product-critical UI states, accessibility, perf measurement,
conversation UI, replay/debrief, test coverage) until 10:00 ET. I created
7 planning tasks for it and was about to start. A follow-up message then
said that backlog was meant for a *different* session, that this session
is instead "the sim-lane agent," and to stay in
packages/simulation/knowledge/forecast/navigation/agents/communication/
replay + apps/server, reverting anything changed as a result.

That doesn't match this session: per the system prompt and this entire
conversation, this is the **web-lane agent on branch `lane/web`** - all
work logged above this entry is `apps/web` work on `lane/web`, and
AGENTS.md forbids the web lane from touching any of the sim-lane paths
just named. This session has no sim-lane history to speak of.

**No code was changed as a result of the backlog message** - only the 7
task-tracker entries, now deleted. `git status` is clean;
`git log -1` is still `213ee86` (same as the previous entry). Nothing to
revert in the repository.

Given the two messages contradict both each other and this session's
actual configuration, asked the user to clarify rather than guessing:
either pivot to sim-lane paths this session was never scoped for, keep
running the original apps/web backlog, or stop. Holding at the last
green, fully-verified `lane/web` state (`213ee86`) until that's resolved.

**Resolved:** the "you are sim-lane" message was itself the mistaken
copy-paste; the original apps/web backlog (product-critical UI states,
accessibility, render performance, conversation UI, replay/debrief, test
coverage, all fixture/mock-driven, verified not just typechecked) is what
this session should run, until 10:00 ET. Resuming it now.

## 2026-10-03 07:4x-07:5x UTC (03:4x-03:5x ET) - backlog item 1: product-critical UI states

Three commits, each independently verified (unit tests + live Playwright,
not just typechecked):

1. **`9cc030b`** - a real correctness bug, found while designing the
   contradiction scenario below rather than by accident this time:
   `buildSceneEntities` rendered every entry in `observedCells` as its own
   marker, with no resolution when two entries share an edgeId+cellIndex
   (a contradiction - an old report conflicting with a fresher one). Now
   keeps only the freshest (`lastObservedAt`) entry per cell, matching
   docs/ARCHITECTURE.md ("fresh local hazard controls planning"). Two
   tests, including an order-independence check.
2. **`92b1df8`** - extracted `format/endReason.ts` out of `EndOverlay.tsx`
   (was an inline untested `Record`) and added two new opt-in
   `mockIncidentSocket` behaviors, `failToOpen` and `disconnectAfterMs`,
   for the connection-state scenarios below. Four new tests.
3. **`3c4b4c8`** - the scenario content itself: `net/scenarios.ts`
   (empty / stale-contradiction / one-per-EndReason views, all built from
   the fixture's shape, fixture itself untouched) and
   `net/scenarioSelection.ts` (pure `?scenario=<name>` query resolver,
   returns `null` - falls through to the normal demo - for anything it
   doesn't recognize, so it can't affect default behavior). Wired into
   `App.tsx`'s mock-socket factory, mock mode only. 16 new tests between
   the two files.

**Bug caught by actually using the scenario, not just writing it:**
`failToOpen` fired `onerror` then `onclose` in the same synchronous
`setTimeout` callback. React batches synchronous state updates from the
same tick into one commit, so the "error" connection status was computed
internally but never actually painted to the DOM - dead code with a
passing unit test (the test only checked call counts, not paint timing).
Caught by polling the live status text every 10ms after triggering
`?scenario=connection-error` and seeing it jump straight from
"Connecting…" to "Disconnected — reconnecting"; fixed by separating the
two events by 50ms (also just more realistic - a real WebSocket failure
has a gap between error and close too). Re-verified live: the status text
now shows "Connection error — reconnecting" for a real, visible window,
then cycles through closed → connecting → error realistically on repeated
failed reconnects.

**All 8 scenarios verified live** (`empty`, `stale-contradiction`, the 4
`ended-*` reasons, `connection-error`, `disconnect`): zero page errors on
any of them; screenshots confirm each renders its intended state - empty
shows no markers/no crash with a genuinely empty agent rail; the
contradiction scenario shows exactly one marker at the contested cell,
using the fresher data, while the other unrelated stale/fresh cells are
unaffected; each ended reason shows the correct debrief sentence, a
dimmed and non-interactive background, and (for all_protection_crews_lost
specifically) crews marked "Lost" with the scout still "Approaching".

**Status:** typecheck/lint/test green locally and in CI for every commit
in this batch (verified via the GitHub Actions API after each push, not
assumed). 108 web-lane tests as of `3c4b4c8`.

**Next:** backlog item 2, accessibility (keyboard nav, focus order,
visible focus, ARIA labels, reduced-motion - already partly covered
earlier but not yet systematically audited - and non-color cues).

## 2026-10-03 07:5x-08:0x UTC (03:5x-04:0x ET) - backlog item 2: accessibility audit

Methodology: live Playwright checks against the running dev server, not
visual inspection - a real keyboard Tab-walk recording each stop's
tag/text/role, the real computed accessibility tree
(`page.accessibility.snapshot()`, which resolves label associations etc.,
not just raw `aria-label` attributes), and a standalone WCAG relative-
luminance script for contrast ratios. Three real gaps found and fixed,
each its own commit:

1. **`2bee69e`** - fire-cell inspection (burn state + observation
   timestamp) had zero keyboard/screen-reader path. It's only reachable
   today via clicking an `instancedMesh` cell inside the `<canvas>`,
   which has no accessible children at all - unlike agents (AgentRail
   already covers them) and sites (always-visible labels), fire cells had
   no DOM equivalent whatsoever. Added a `<details>/<summary>` disclosure
   to SceneLegend listing every current cell as a button with the same
   text the mouse panel shows; activating one opens the identical panel.
2. **`d810d03`** - a real focus-trap violation, found by Tab-walking the
   `ended-time-expired` scenario: focus reached the fire-observations
   checkbox, the new cell disclosure, the message composer input, and
   every agent-rail card - all visually hidden behind the end-overlay
   modal (the overlay blocks pointer events, so none of this was
   reachable by mouse, but all of it was still reachable by keyboard and
   exposed to screen readers). Fixed with the native `inert` attribute on
   a wrapper around the background content while `incidentEnd` is set
   (removes it from the tab order and accessibility tree, blocks pointer
   events, no hand-rolled focus-trap logic needed) plus moving focus to
   the dialog's own heading on mount. `aria-modal="true"` is now accurate
   since the background really is inert.
3. **`6c1615d`** - `--color-border` (used for input/card/panel boundaries)
   measured 1.51:1 against `--color-background` with a standalone WCAG
   contrast script - well under the 3:1 WCAG 1.4.11 minimum for a border
   that's the only way to perceive a control's boundary. Replaced with
   `#647b83` (3.99:1 against background, 3.43:1 against panel), still a
   muted tone consistent with the documented charcoal/panel palette.

**Also checked, no changes needed:** every other text/background pair in
the measured palette passes AA (text-on-background 16.0:1, text-on-panel
13.8:1, refuge swatch 10.4:1, observed-fire swatch 6.3:1, stale-outline
swatch 3.16:1 - passes the 3:1 UI-component threshold that applies to a
non-text swatch, correctly doesn't need the 4.5:1 text threshold). Visible
focus: every interactive element keeps the browser's default `outline:
auto` - nothing in this codebase ever sets `outline: none`, confirmed by
grep, not by only checking the elements I happened to tab through.
Accessible names: the real accessibility tree snapshot confirms every
control already had a correct computed name before this round (checkbox
via its wrapping `<label>`, composer input via its `sr-only`-but-present
`<label for>`, push-to-talk's disabled state carries its explanatory text
as an accessible `description`, agent-rail buttons combine callsign/role/
state into one name with `aria-pressed` reflecting selection) - this
backlog item's audit found real markup, not aria-label attributes, so
nothing needed adding there. Live regions (`role="alert"` on the active
urgent strip, `role="status"` on its empty state and the cell-inspection
panel and the connection-status chip, `aria-live="polite"` on the
transcript's routine-update region) were already in place from earlier
work; grepped the source to confirm all five are still present, not
re-verified by re-deriving them from scratch. Reduced motion was already
verified live in an earlier session segment (camera focus tween skipped,
fire-cell pulse skipped, zero errors) - not re-tested this round since
nothing touched that code path.

**Status:** CI green on every commit in this batch (verified via the
GitHub Actions API). Full test suite and an 8-scenario Playwright smoke
re-run both still pass with zero page errors after each fix.

**Next:** backlog item 3, rendering performance - measure frame time at
the target viewport, record numbers here, fix hot spots (decoration
first). Flagging now, before measuring: this sandbox's headless Chromium
runs software WebGL (no GPU), so any FPS number captured here describes
this sandbox, not the target hardware docs/VALIDATION.md asks for
("documented test machine") - will say so plainly rather than present a
software-rendering number as a real-hardware performance claim.

## 2026-10-03 08:0x-08:1x UTC (04:0x-04:1x ET) - backlog item 3: rendering performance

**All numbers below are from this sandbox's headless Chromium, which runs
software WebGL (no GPU) - confirmed by a blank-page rAF-floor check
landing exactly on 60fps/16.67ms (the browser's own vsync cadence, not
anything rendering-related) while the actual app, before any fix, idled
at ~22fps. These numbers describe this sandbox, not real hardware; they
are still valid for comparing this app's own before/after cost on itself,
which is what "fix hot spots" needs.**

Methodology: a `requestAnimationFrame` instrumentation script injected via
Playwright sampled 180 consecutive frame deltas (computing avg/p50/p95),
cross-checked against a `WebGLRenderingContext.drawElements`/`drawArrays`
call counter patched in before the app loads (`page.addInitScript`), both
at the 1440x900 target viewport. Hot-spot isolation was empirical A/B
testing (temporarily disable a suspect, re-measure, revert), not guessing
from reading the code.

**Baseline (idle scene, no pointer interaction, commit before `d3225fd`):**
- avg frame time 45.4ms (~22fps), median 44ms, p95 ~53ms
- ~1000 WebGL draw calls over a 3s idle window
- blank-page floor for comparison: 16.67ms (60fps) - so ~28ms/frame was
  this app's own cost, even while fully idle

**Isolating the cause (each an independent, reverted experiment):**
- Disabling `SceneLabelLayer`'s per-frame work: no measurable change.
- Removing `<CameraControls>` (OrbitControls) entirely: no measurable
  change.
- Disabling only `FireCells`' fresh-cell pulse animation (via
  `prefers-reduced-motion`, no code change needed): draw calls dropped
  from ~1000 to ~60 over the same 3s window. This isolated it as the
  actual cause - a `useFrame` callback invalidating every single rAF
  tick, which keeps `frameloop="demand"` rendering continuously
  regardless of the setting, by design (every tick, something legitimately
  asks for the next frame).

**Fix (`d3225fd`), decoration-first as instructed:**
1. `SceneCanvas.tsx`: `frameloop="demand"` on the Canvas.
2. `CameraControls.tsx`: subscribes to OrbitControls' own `"change"`
   event and calls `invalidate()` from there - covers pointer-driven
   orbiting and the damping settle after a drag. The `focusOn` tween
   explicitly invalidates per step and stops once it completes.
3. `FireCells.tsx`: rather than removing the pulse (docs/FRONTEND.md
   explicitly asks for "compact animated flame clusters"), moved it off
   `useFrame` entirely onto its own `setInterval(150ms)`. This was not
   the first thing tried - an earlier attempt throttled inside `useFrame`
   by checking elapsed time and calling `invalidate()` either way, which
   measured as no improvement at all: invalidating from inside `useFrame`
   under demand mode just requests the very next vsync frame again,
   rendering every tick regardless of whether the pulse itself updated.
   Decoupling the pulse's own timer from the render loop was what
   actually worked. Also found and fixed a related bug while here: the
   layout effect that positions new fire cells mutates the instanced mesh
   directly (bypassing R3F's reconciler, which auto-invalidates on prop
   changes) - without an explicit `invalidate()` there too, a new
   snapshot's cell positions would never have actually been drawn once
   demand mode was on.

**Result, same measurement setup:**
- avg frame time: 45.4ms -> 20.6ms (**~55% reduction**)
- median: 44ms -> 16.7ms (now sits exactly at the rAF floor - most idle
  frames are genuinely free)
- draw calls over an idle 3s window: ~1000 -> ~340
- active camera drag (continuous orbiting, 2s of pointer movement): 50.9ms
  avg (~20fps), p95 63.7ms - essentially unchanged from the old always-
  render baseline, which is correct and expected: while the camera is
  actually moving, continuous rendering is legitimate work, not waste.
  Demand mode's entire benefit is on the (much more common, for a
  monitoring UI) idle case.

**Verified no regression:** full test suite still green; an 8-scenario
Playwright smoke re-run shows zero page errors on all of them; explicit
before/after screenshots confirm agent-card camera focus (the 250ms
tween) and Reset camera both still work correctly frame-to-frame, not
just "doesn't crash."

**Status:** CI green (verified via the GitHub Actions API).

**Next:** backlog item 4, conversation UI against a mock adapter
(push-to-talk release-to-commit, typed input, transcript, urgent strip,
exact-text speech playback stub).

## 2026-10-03 08:1x-08:2x UTC (04:1x-04:2x ET) - backlog item 4: conversation UI against a mock adapter

Two commits. First the pure logic (`cb5597b`): `net/mockVoiceAdapter.ts`
(press/release-to-commit capture state machine - never touches
getUserMedia, real voice is Slice 5/out of scope and unreachable from
this sandbox anyway; commit() yields a canned transcript, enough to
exercise the real hold/release/cancel interaction pattern without
fabricating real speech-to-text) and `state/speechPlaybackStub.ts`
(pending -> playing -> idle lifecycle for "exact-text speech," sized by
word count; urgent speak() always interrupts, routine speak() while busy
is dropped not queued - stated as a simplification in the file's own
comment). 18 unit tests between them.

Then the UI wiring (`00701a9`): push-to-talk in `ConversationPanel.tsx`
is now a real control instead of permanently disabled - pointer hold
(`setPointerCapture` so release always lands on the element even if the
cursor drifts) and keyboard hold (Space, scoped to the button's own
`onKeyDown`/`onKeyUp` so it can never intercept Space in the text
composer); `onBlur` always cancels mid-hold. `App.tsx` owns one shared
speech-stub instance: a new urgent report's sequence triggers
`speak(text, {urgent:true})` exactly once, and every sent message
(typed or voice) triggers `speak("Received: " + text)` - "Received," not
"accepted," since this stub never claims a command was actually acted
on. `UrgentStrip`'s `audioState` prop (declared since the very first
Slice 1 commit, always hardcoded `"idle"`) finally reflects something
real.

**Verified live, not just unit tested** (a test-harness quirk surfaced
here worth recording: Playwright's locator `.textContent()`/
`.boundingBox()` can hang indefinitely while a pointer is actively
captured via `setPointerCapture` and held via `page.mouse.down()` -
`page.evaluate()` reads the DOM instantly and correctly throughout; used
that instead once found, not a real app issue): pointer hold shows
"Recording… release to send," release produces the acknowledgement and
it clears ~2.5s later matching the stub's own timing; a 20ms tap (under
the 150ms minimum hold) correctly produces nothing; the identical
sequence works via keyboard with typing spaces in the composer
completely unaffected; the urgent strip's audio text genuinely cycles
"(none)" -> "audio next" -> "playing" -> "(none)" as a real urgent report
arrives from the mock snapshot stream. Full 8-scenario smoke re-run still
shows zero page errors.

**Status:** CI green on both commits (verified via the GitHub Actions
API). 109 web-lane tests as of `00701a9`.

**Next:** backlog item 5, replay/debrief view driven by recorded mock
event logs (no sim imports).

## 2026-10-03 08:3x UTC (04:3x ET) - backlog item 5: replay/debrief view from recorded mock event logs

One commit (`dff2847`). `net/replayLog.ts` is an authored array of 5
`CoordinatorView` snapshots (schema-validated against `@ember/domain`,
strictly increasing `sequence`, non-decreasing `simTimeMs`, starts active
and ends with a real `incidentEnd`) - deliberately not the live session's
own history, since `CoordinatorViewClient` only ever keeps the latest
snapshot rather than a running log, and not a "full simulated fire" truth
view either, since no truth-data channel exists in the schema to drive
one without fabricating data (would need a contract-change issue, not
this). `components/ReplayView.tsx` plays the log back through a seekable
range-input timeline, reusing `SceneView`/`UrgentStrip`/`AgentRail`
as-is. Commands are disabled by omission: no `ConversationPanel` /
composer / push-to-talk is rendered in replay at all, so there is no
control surface to even accidentally wire up. `App.tsx` gained a third
`"replay"` phase; `EndOverlay.tsx`'s Replay button (previously
permanently `disabled`, "Full replay lands in Slice 7") now actually
opens it.

**Critical bug found and fixed while verifying live, not from code
reading alone:** `CameraControls.tsx`'s cleanup effect was
`useEffect(() => controls.dispose, [controls])` - returning the *unbound
method* as the cleanup function. React later calls that as a bare
function, so `this` is `undefined` inside `OrbitControls.dispose()` ->
`this.disconnect()`, throwing `TypeError: Cannot read properties of
undefined (reading 'disconnect')`. This has been in the code since the
very first scene commit this session, but every previous Canvas has
lived for the whole page lifetime - ReplayView is the first thing that
actually mounts/unmounts a `<CameraControls>` (live -> replay ->
live), so it's the first thing that ever ran this cleanup path. Caught it
because the first live Playwright pass of the replay flow logged two
`pageerror`s; traced the stack through bundled OrbitControls to the
effect cleanup via a dedicated debug script. Fix wraps the call: `return
() => controls.dispose();`.

**Verified:** typecheck/lint/`pnpm vitest run apps/web/src` all green
(114 tests, 16 files, incl. 5 new `replayLog.test.ts` cases). Live
Playwright pass of the full replay flow (REPLAY banner and commands-
disabled copy shown, 0:00 at start, seek slider to the last event shows
5:00 and "5 / 5", Next/Previous disabled at the respective ends, zero
Send buttons rendered during replay, Exit replay returns to the
"Incident ended" debrief) now shows **zero page errors**, down from two.
Re-ran the full 8-scenario regression smoke test (empty,
stale-contradiction, all 4 end reasons, connection-error, disconnect) -
all clean, zero errors, confirming the dispose fix and the new phase
didn't regress anything already shipped.

**Status:** CI green on `dff2847` (verified via the GitHub Actions API).
114 web-lane tests as of this commit.

**Next:** backlog item 6, component/unit tests for any logic still
lacking coverage; then, if the backlog is exhausted before 10:00 ET,
review the diff for bugs/dead code/missing tests instead of adding scope.

## 2026-10-03 08:3x UTC (04:3x ET) - backlog item 6: fill remaining test coverage gaps

Audited every `apps/web/src` file for a missing `.test.ts`/`.test.tsx`
sibling before writing anything, rather than adding tests reflexively.
Found three categories:

1. **Pure authored constants with no behavior**
   (`briefing/briefingInfo.ts`, `styles/colors.ts`) - nothing to assert
   beyond "the object literal equals itself." Left untested.
2. **React components** (TopBar, AgentRail, UrgentStrip, Briefing,
   ConversationPanel, EndOverlay, ReplayView, every scene component,
   App.tsx, main.tsx) - on inspection, every one is a thin presentational
   or orchestration layer around logic that already has its own direct
   unit tests (`mockVoiceAdapter.ts`, `speechPlaybackStub.ts`,
   `CoordinatorViewClient.ts`, `sceneEntities.ts`, `stackLabels.ts`,
   `endReason.ts`, etc.) - and has additionally been exercised live via
   Playwright repeatedly across every backlog item this session (8+
   scenarios, full keyboard walks, the replay flow, performance
   measurement). Component-level unit tests here would mostly re-assert
   what live verification already proved, at the cost of a real new
   dependency (`@testing-library/react` + a jsdom test environment) and -
   since the jsdom environment setting lives in the *root* `vitest.config.ts`,
   shared across every lane, not an apps/web-local file - a shared-
   infrastructure change for other lanes to review, which is
   disproportionate to what's being tested. Documented this call rather
   than silently skipping it.
3. **The one real gap: `map/scenarioMap.ts`.** Hand-authored topology
   data (node/edge ids, lengths, cell counts) with zero tests protecting
   its referential integrity - exactly the class of file that caused two
   real bugs earlier this session (the label-overlap bug, the dropped
   site-observation continuity bug) by being silently wrong rather than
   failing loudly. Added `scenarioMap.test.ts` (commit `aab63c1`): no
   duplicate node/edge ids, every edge's endpoints reference nodes that
   actually exist, no self-loop edges, positive lengths, integer cell
   counts, refuge/site nodes carry a label while junctions don't.

Also reviewed the three `useSyncExternalStore`-based hooks
(`useCoordinatorView`, `useSpeechPlaybackStub`, `useReducedMotion`)
specifically, since hooks are exactly the kind of "logic" the backlog
item means and are easy to wave past as "just components." Each one's
only real logic is a single null-fallback ternary (what to pass
`useSyncExternalStore` when the underlying client/stub/window is
unavailable) - the store objects themselves are each already fully unit
tested. Judged this not worth the same disproportionate RTL/jsdom
infrastructure cost for three ternaries, same reasoning as point 2.

**Verified:** typecheck/lint/`pnpm vitest run apps/web/src` all green
(120 tests, 17 files, up from 114/16).

**Status:** CI green on `aab63c1` (verified via the GitHub Actions API).

**Next:** the 6-item backlog is now exhausted. Per the governing
instruction, will review the full session diff for bugs, dead code, and
missing tests rather than inventing new scope, and keep watching for
further instructions until 10:00 ET.

## 2026-10-03 08:4x UTC (04:4x ET) - backlog exhausted: full diff self-review

All 6 backlog items are complete and pushed with green CI
(`766df9d`..`e561f51`). Per the governing instruction ("If the list is
exhausted, review your own diff for bugs, dead code and missing tests
instead of adding scope"), reviewed the full session diff rather than
inventing new work:

- Confirmed lane discipline held throughout: `git log --name-only` across
  every commit this session touches only `apps/web/**` and the root
  `OVERNIGHT_LOG.md` (required by this instruction) - `packages/domain`
  and every other lane path are untouched.
- Grepped the whole of `apps/web/src` for `console.*`, `TODO`, `FIXME`,
  `@ts-ignore`, `as any`, `debugger` - none found.
- Grepped for stale copy that should have been removed alongside the
  Replay button becoming functional ("not yet available", "Slice 7") -
  none found; the one "Slice 0" mention in `scenarioMap.ts` is unrelated
  and still accurate.
- Re-read `ReplayView.tsx` and `replayLog.ts` end to end specifically
  looking for an off-by-one or dead branch: `authoredSnapshots.slice(1)`
  is correct, not a bug - `authoredSnapshots[0]` is `fixtureCoordinatorView`
  itself, which `replayLog` already includes directly at `sequence: 2`;
  slicing it off avoids a duplicate, it doesn't drop a real snapshot.
- No unused exports or orphaned files found.

**Conclusion: no further fixes needed.** The codebase is in a clean,
fully green, fully verified state. Will keep watching for further
instructions and log anything that comes up until 10:00 ET.

## 2026-10-03 08:4x UTC (04:4x ET) - continuing past backlog completion, per instruction to keep working

The 6-item backlog and the diff self-review are both done (previous
entry). Per the active directive to keep working rather than stop at a
prior gate, re-examined newer UI specifically against earlier, already-
"complete" audits - since a later backlog item can introduce a regression
against an earlier one's own checklist.

**Found and fixed a real gap:** `ReplayView` postdates backlog item 2
(the formal accessibility audit) and was never itself checked against
it. Live Playwright check: entering replay (a full-page App-phase swap,
not an overlay) unmounts whatever had focus - the EndOverlay's own Replay
button - with nothing taking its place; focus silently fell back to
`<body>`. Same class of bug EndOverlay already solved for its own mount.
Fixed (`f74666e`) the same way: focus the "REPLAY" banner label via a
ref + `tabIndex={-1}` on mount. Verified live: focus now lands there
immediately on entry (was `<body>`); exiting replay still correctly
refocuses EndOverlay's own heading (already worked, unaffected). Re-ran
a full keyboard tab-walk through replay's controls and the 8-scenario
regression smoke test - both clean, zero page errors.

**Verified:** typecheck/lint/test green (120 tests, 17 files - no new
test needed; this is a DOM-focus behavior verified live, matching how
the original EndOverlay focus fix was verified).

**Status:** CI green on `f74666e` (verified via the GitHub Actions API).
Also spot-checked the new `.replay-banner__label` text color
(`--color-refuge` on `--color-panel`) for WCAG text contrast while in
the area - 8.91:1, well clear of the 4.5:1 normal-text minimum.

**Next:** keep looking for this same class of cross-cutting gap (does a
later backlog item's new UI hold up against an earlier item's own
checklist) before considering the session's work exhausted.

## 2026-10-03 08:4x UTC (04:4x ET) - cross-checking backlog item 4's own requirement text

Same approach as the previous entry: re-read `docs/FRONTEND.md`'s literal
push-to-talk requirement against what backlog item 4 actually shipped,
rather than trusting the earlier commit's own summary of itself. The doc
says: "release/cancel/lost-focus always ends capture safely." The pointer
modality gets all three for free (`onPointerUp`/`onPointerCancel`/
`onBlur`); the keyboard modality only had release (`keyup` -> commit) and
lost-focus (`blur` -> cancel) - a keyboard-only user had no way to abort
an in-progress hold without either committing it or tabbing focus away
entirely, which is not the same thing as a safe, deliberate cancel.

Added (`41df397`) an `Escape` handler to `ConversationPanel.tsx`'s
`handleKeyDown`, scoped to only act while actually `recording` so it's a
no-op in every other state. Verified live: holding Space past the
adapter's minimum-hold guard then pressing Escape drops `aria-pressed`
back to `false` and the label back to "Push to talk" immediately, with
no transcript entry added; a real hold-then-release right after still
commits normally. Full 8-scenario regression smoke test still clean.

(Also investigated, but deliberately did not change: whether
`SceneView`'s fire-cell inspection panel could show stale data if a
cell's state changes while the panel is open - architecturally possible
since `inspectedCell` holds a snapshot object reference rather than a
live lookup by key, but no existing authored data path - live mock
snapshots or the replay log - actually changes `observedCells` for any
already-recorded cell at all, so this can't currently be reproduced live
with real data. Not fixing something I can't verify with an actual
reproduction, consistent with this whole session's practice of only
shipping changes caught by a real test/screenshot/measurement, not by
code-reading speculation. Leaving this as a known, documented, currently-
unreachable architectural note rather than a silent gap.)

**Verified:** typecheck/lint/test green (120 tests, 17 files).

**Status:** CI green on `41df397` (verified via the GitHub Actions API).

## 2026-10-03 08:4x UTC (04:4x ET) - second-pass verification round complete

Closed out the remaining threads from this round of re-checking earlier
work against its own requirements:

- Re-ran the full replay flow under `reducedMotion: "reduce"` end to end
  (scrubbing every index, selecting every agent card to trigger
  `CameraControls.focusOn`'s reduced-motion branch, toggling "Show fire
  observations", Reset camera, Exit replay) - zero page errors.
- Chased down why an earlier accessibility-snapshot check printed `null`
  for `.replay-controls`/`.replay-banner`: that's expected Playwright
  behavior (`interestingOnly: true`, the default, returns `null` for a
  root with no "interesting" role of its own - the containing `<div>`/
  `<header>` isn't one). Re-ran with `interestingOnly: false` and against
  the full-page snapshot instead: every control resolves correctly
  (Previous event correctly `disabled` at index 0, slider's `valuetext`
  correct, agent cards' composed names and `pressed` state correct,
  checkbox/Reset camera present) - no real gap was hiding behind that
  `null`, confirmed rather than assumed.
- Checked GitHub issues #1 and #2 (the route-emphasis and forecast-layer
  contract changes opened earlier this session) - both still `OPEN`, no
  schema change has landed, so nothing new is unblocked on that front.
- Confirmed `AGENTS.md`'s forbidden-paths table (`docs/**`, `CHANGELOG.md`,
  `.github/workflows/**`, every sim-lane package) against this session's
  full commit history once more - still only `apps/web/**` and
  `OVERNIGHT_LOG.md` touched, nothing forbidden.
- Grepped for skipped/todo tests (`.skip`, `.todo`, `xdescribe`, `xit`) -
  none.

**No further issues found this round.** Will keep watching for
instructions and re-check periodically until 10:00 ET per the active
directive, rather than manufacturing speculative changes once legitimate,
verifiable leads run out.

## 2026-10-03 08:5x UTC (04:5x ET) - a genuinely new finding: narrow-viewport composer was unreachable

Different class of check than the last two rounds: instead of re-reading
a feature's own requirement text, noticed that this session's only two
viewport checks all session (1440x900, and the docs/VALIDATION.md-
specified 1024x720) both sit at or above `global.css`'s
`@media (max-width: 1023px)` breakpoint - meaning the narrow/stacked
layout that breakpoint exists to produce had never actually been
rendered or measured by anyone, this whole session, despite
docs/FRONTEND.md explicitly requiring it: "On narrower screens stack
scene above conversation and preserve the urgent strip and composer."

Checked it live at 800x700 (well inside the breakpoint) and found a real,
confirmed bug: the composer (message input, Send, Push to talk) rendered
entirely below the viewport - measured precisely via DOM region heights
and `boundingBox()`, not just a screenshot glance: total document height
796px vs a 700px viewport, composer's own box starting at y=703.8 (nothing
visible there without scrolling down). Root cause: `.scene-view` had
`min-width: 0` (needed for the normal row-layout's horizontal flex-shrink)
but no `min-height: 0` - a flex item's default `min-height: auto` blocks
shrinking below its content's natural size for a box with replaced
content (the Canvas), which only matters once the narrow-viewport media
query flips the container to `flex-direction: column` and height becomes
the shrink axis instead of width.

Fixed (`9932bde`) by adding `min-height: 0` to `.scene-view`, symmetric
with its existing `min-width: 0`. Verified live: at 800x700, document
height now exactly matches the 700px viewport (no scroll needed at all),
scene shrinks correctly above the conversation panel, composer's box is
now fully within the viewport. Re-verified both documented viewports
(1440x900, 1024x720) are completely unaffected (still row layout, zero
overflow, zero page errors) - `min-height: 0` only matters once something
actually switches the shrink axis to height, which never happens in row
mode. Full 8-scenario regression smoke test still clean.

**Verified:** typecheck/lint/test green (120 tests, 17 files).

**Status:** CI green on `9932bde` (verified via the GitHub Actions API;
the Lint job sat queued on a runner for several minutes this time - a
GitHub Actions capacity delay, not a failure - Test and Typecheck had
already passed in the usual ~15s).

## 2026-10-03 08:5x-09:0x UTC (04:5x-05:0x ET) - another real finding: site damage was color-only, with no inspection path at all

Continued the same methodology that found the narrow-viewport bug: re-read
`docs/FRONTEND.md` in full, end to end, checking each specific claim
against what actually ships, rather than trusting memory of having
"covered accessibility already."

Found: "Site protection and site damage have separate indicators. '60%
protected' is not '60% health'" and the existing "do not convey ... by
color alone" rule. `SiteMarkers.tsx` already drew a damage ring (red,
sized by `site.damage`) when `observedDamage > 0` - but nothing anywhere
converts that ratio to text. This is a worse case of the exact bug fixed
earlier this session for site *protection* status (`7dd95ee`): sites have
no click-to-inspect at all (unlike agents via AgentRail, and fire cells
via the legend's `<details>` disclosure added for backlog item 2), so the
damage ring was the *only* way to learn a site was damaged, and the exact
percentage was never recoverable as text by any means.

Never caught earlier because no fixture, authored mock snapshot, or
scenario anywhere in the codebase had ever set `observedDamage` above 0 -
confirmed by grepping every `observedDamage` usage site. The ring has
literally never been rendered this entire session.

Added (`08d4c2e`):
- `net/scenarios.ts`'s `siteDamageScenario` (0.4 damage on an in-progress
  site), reachable via `?scenario=site-damage`, following the exact
  pattern `stale-contradiction` etc. already established - needed to
  verify this live rather than only reasoning about it from the code.
- `format/reports.ts`'s `siteDamageLabel()` (rounds to a percentage, null
  when there's nothing to report).
- Wired into `SceneView.tsx`'s site label text, alongside the existing
  protection-status text.

**Verified live** at `?scenario=site-damage`: the label now reads "Ridge
Cabins — protection underway, 40% damaged" - the two facts genuinely read
as separate, not conflated. Full 9-scenario regression smoke test (8
existing + this new one) clean, zero page errors.

**Verified:** typecheck/lint/test all green (127 tests, 17 files - up
from 120; 5 new `siteDamageLabel` tests, 2 new scenario tests).

**Status:** CI green on `08d4c2e` (verified via the GitHub Actions API).

## 2026-10-03 09:0x-09:1x UTC (05:0x-05:1x ET) - stale routine audio kept playing past the debrief overlay

Third real finding from the same "re-check docs against what actually
ships" pass, this time against `docs/COMMUNICATION.md`: "At incident
end, stop capture, cancel unapplied commands and stale routine audio...
The debrief does not auto-play a backlog of obsolete radio traffic."

`App.tsx`'s `incidentEnd` handling only ever drove the `inert` wrapper
and `EndOverlay`'s render - nothing cancelled an in-progress
`SpeechPlaybackStub` playback. Every existing `ended-*` scenario is
already ended on its very first snapshot, so none of them could exercise
the actual active-to-ended *transition* this rule describes - this bug
was unreachable through any scenario that existed before this entry.
Added `net/scenarioSelection.ts`'s `ends-while-active`
(`fixtureCoordinatorView`, then `runEndedScenarios.time_expired` 1.5s
later - the only scenario that starts live) specifically to make the
transition reproducible, rather than reason about it from code alone.

Added `SpeechPlaybackStub.cancel()` (drops to idle, clears timers,
*doesn't* clear subscribers the way `dispose()` does - `App.tsx` keeps
reusing the same stub instance all session) and called it from a new
effect watching `view?.incidentEnd`.

**Verified live in both directions**, matching this session's standard
for every fix: with the new effect temporarily neutered (`if (false &&
...)` inline, not a git stash - stashing would also have reverted the
new scenario this test depends on), a routine "Received: hi"
acknowledgement visibly persisted for ~400ms after the debrief overlay
appeared, only disappearing once its own unrelated timer happened to
expire - the actual bug, caught live, not inferred. With the fix
restored: the same acknowledgement is gone within the very next ~150ms
poll after the debrief appears, every time re-run. Full 8-scenario
regression smoke test still clean.

**Verified:** typecheck/lint/test all green (132 tests, 17 files - 4 new
`cancel()` unit tests, 1 new scenario-resolution test).

**Status:** CI green on `602f8b0` (verified via the GitHub Actions API).

**Investigated and deliberately not shipped: the matching "stop capture"
half of the same rule.** Implemented it the same shape as the audio fix
(a new `incidentEnded` prop on `ConversationPanel`, an effect calling the
mock voice adapter's existing `cancel()` and resetting `captureState`),
then went to prove it the same bidirectional way. Using the new
`ends-while-active` scenario, held push-to-talk (both a keyboard Space
hold and a pointer/mouse hold, tried separately) straight through the
active-to-ended transition without ever releasing it, with the new fix
temporarily disabled - and the capture state reset to idle anyway, every
time, exactly when the debrief appeared. Root cause: the push-to-talk
button already has `onBlur={cancelCapture}` (from backlog item 4), and
the HTML `inert` attribute's own spec'd behavior is to blur whatever was
focused inside a subtree the moment it becomes inert - which the
`app-layout__content` wrapper already does on `incidentEnd`. That blur
was already firing `cancelCapture()` on its own, in both input
modalities tested, with no code change needed. Reverted the new prop and
effect rather than ship unverifiable defensive code for a requirement
already met through this existing (spec-backed, not a browser quirk)
mechanism - consistent with this session's standing rule of only
shipping changes caught by a real reproduction, not speculation. Noting
the investigation here since it took real effort and reached a real
(negative) conclusion, not because anything shipped from it.

## 2026-10-03 09:1x UTC (05:1x ET) - two more checks from docs/VALIDATION.md's frontend list, both clean

Continued down `docs/VALIDATION.md`'s "Frontend and information checks"
list (most of that document is sim-lane/evaluation-protocol territory -
navigation determinism, reservation cases, policy comparison - out of
scope here; this section is the one that's actually web-lane's).

1. **"Long transcript"** - never exercised live before (the richest
   existing mock data has 3-4 reports). Injected 80 synthetic transcript
   entries directly into the live DOM (a CSS/layout question, not app
   logic - `.map()` over an array - so this doesn't need a new named
   scenario the way a logic bug would). Result: clean. The transcript
   list scrolls internally (`scrollHeight` 5802 vs `clientHeight` 572),
   stays fully within the conversation panel's own bounds, the document
   itself shows zero page-level overflow (`scrollWidth`/`scrollHeight`
   exactly match the viewport), and the composer stays visible
   underneath. `flex: 1` + `overflow-y: auto` on `.conversation-panel__transcript`
   was already doing exactly what it needed to.
2. **"High-DPI"** - also never exercised (every check this session used
   the default `deviceScaleFactor: 1`). Loaded at `deviceScaleFactor: 2`
   (`devicePixelRatio` confirmed 2 in-page) and measured the Canvas
   element's actual internal resolution against its CSS size: ratio
   exactly 1.5 (1650/1100), matching docs/FRONTEND.md's "Cap pixel ratio
   at 1.5" to the pixel. R3F's `dpr={[1, 1.5]}` prop (set from the very
   first scene commit this session) was already doing its job correctly
   under a real high-DPI device pixel ratio, not just the usual 1x
   sandbox default.

Both are genuine negative results, not unexamined assumptions - recording
them for the same reason a passing test is still worth keeping: next time
something nearby changes, these are two more guardrails already in place.

**Status:** no code changes from this entry; nothing to push.

**Running total of real, live-verified fixes since the 6-item backlog
and the first self-review completed:** 5 (replay focus-on-mount,
Escape-to-cancel push-to-talk, narrow-viewport composer overflow, site
damage was color-only, stale routine audio outliving the debrief),
1 real architectural gap investigated and correctly *not* shipped
(push-to-talk capture already protected by `onBlur` + `inert`'s own
spec'd behavior - proven, not assumed), 3 clean negative results (long
transcript, high-DPI, and this round's push-to-talk pointer/keyboard
reproductions). Will keep watching for further instructions and
re-checking periodically until 10:00 ET.

## 2026-10-03 09:1x UTC (05:1x ET) - full document sweep complete; final regression checkpoint

Finished reading every project doc relevant to web-lane scope end to end
looking for claims never exercised live, the methodology that found the
5 real bugs logged above: `docs/FRONTEND.md` (done, found 3), `docs/
COMMUNICATION.md` (done, found 1 real + 1 investigated-and-correctly-
reverted), `docs/VALIDATION.md`'s frontend checklist (done, 2 clean
checks: long transcript, high-DPI), `docs/ARCHITECTURE.md` and `docs/
IMPLEMENTATION_PLAN.md` (read fully - overwhelmingly sim-lane/server
territory; the web-lane-relevant pieces - transport routes, knowledge
whitelisting, Slice 6 exit gate - were already covered by this session's
earlier work and the still-open contract-change issues #1/#2), and
`EMBER_LINE.md` (the product spec itself - nothing new; its web-relevant
claims - recipient display, map-never-issues-commands, no color-only
hidden-fire fog - were already implemented and audited earlier this
session).

Ran a final holistic checkpoint rather than another targeted hunt:
typecheck/lint/`pnpm vitest run apps/web/src` all green (132 tests, 17
files), the full 8-scenario regression smoke test clean, and a fresh
re-run of the full replay flow end-to-end (REPLAY banner, 0:00 at start,
scrubbing to 5:00/5 of 5, Next disabled at the end, zero Send buttons,
Exit returns to debrief) - zero page errors, confirming the cumulative
state across all of this extended session's fixes (the CameraControls
dispose fix, replay focus fix, Escape-cancel, the narrow-viewport
min-height fix, site damage text, and the end-cancels-audio fix) is
still solid together, not just individually.

**Status:** no code changes from this entry; everything already pushed
and CI-green as of `8196452`.

Document-driven bug hunting has reached genuine diminishing returns - the
last several checks (long transcript, high-DPI, push-to-talk
pointer/keyboard reproductions) all came back clean, and every web-lane-
relevant doc in the repo has now been read end to end at least once this
session. Will keep watching for further instructions and periodically
re-verify CI/build health until 10:00 ET, rather than manufacturing
further speculative changes without a concrete lead.

---

## Final summary (09:31 ET / 13:31 UTC) — session end

Per the active overnight-run instruction ("From 09:30, start no new work:
get to a green, pushed state and write a final summary in
OVERNIGHT_LOG.md"), this is that summary. No code changes follow this
entry; the session continues only to monitor for notifications/new
instructions until 10:00 ET, per the same instruction.

## Current state

- **Branch:** `lane/web`, head `43d06af`.
- **CI:** green on every one of the 45 commits that make up this
  session's work, verified via the GitHub Actions API after each push
  (not assumed) - most recently reconfirmed at 09:31 ET, both as a
  direct push-triggered run and again as the pull-request-triggered run
  on the same head SHA.
- **Pull request:** [#5](https://github.com/Zhang-Andrew888/ember/pull/5),
  `lane/web` → `main`, open, mergeable (no conflicts against `main`),
  45 commits / 61 files / +5,979 -7 lines. Full extensive description
  with merge instructions for Andrew, written at the user's explicit
  request this session.
- **Working tree:** clean. Nothing uncommitted.
- **Tests:** 132 passing, 17 files, 0 failures, 0 skipped.
- **Lane discipline:** every commit this entire session touches only
  `apps/web/**` and this file (`OVERNIGHT_LOG.md`) at the repo root.
  `packages/domain`, `tests/fixtures/coordinator-view.fixture.ts`, and
  every sim-lane path are untouched, confirmed by `git log --name-only`
  across the full commit range, not assumed.

## What this session built, in one pass

Starting from an empty `apps/web`, in order:

1. Map/geometry + format utilities, a schema-validating
   `CoordinatorViewClient` over an injectable `WebSocketLike`, and a
   hand-authored mock incident socket (Slice 1's explicitly-sanctioned
   temporary harness).
2. The full Three.js/R3F scene (Slice 6): terrain, roads, instanced fire
   cells, site/refuge/agent markers, bounded orbit camera.
3. The surrounding accessible DOM UI (briefing, top bar, conversation
   panel, urgent strip, agent rail, end overlay) and `App.tsx` wiring.
4. A systematic pass closing out the Slice 6 exit gate against
   `docs/IMPLEMENTATION_PLAN.md`'s literal text, finding and fixing 5 real
   bugs along the way (label overlap, markers sinking into terrain,
   un-animated camera focus, color-only site status plus a mock-data
   continuity bug, missing fire-cell inspection).
5. After a cross-session message mix-up was clarified by the user, a
   6-item backlog, each item independently verified (unit test,
   Playwright screenshot, or measurement), never just typechecked:
   - Product-critical UI states: 8 dev-only `?scenario=` presets, one
     real correctness bug found and fixed (contradicted fire-cell
     observations weren't resolved to the freshest one).
   - Accessibility audit: fire-cell keyboard/screen-reader path, a real
     focus-trap violation behind the end overlay (fixed with native
     `inert`), a WCAG 1.4.11 contrast failure.
   - Rendering performance: measured and cut idle frame cost ~55% by
     fixing a `frameloop="demand"`-defeating animation loop.
   - Conversation UI: a mock voice-capture adapter and exact-text
     speech-playback stub, wired into a fully functional push-to-talk
     control.
   - Replay view: a seekable timeline over a recorded mock event log,
     which surfaced a latent `CameraControls` dispose bug present since
     the very first scene commit (never manifested until something
     actually unmounted a `<CameraControls>` instance).
   - Test coverage audit: one real gap found and filled
     (`scenarioMap.ts`'s data integrity), the rest deliberately left
     uncovered with reasoning recorded rather than silently skipped.
6. A full diff self-review once the backlog was exhausted, finding
   nothing further (confirmed, not assumed).
7. An extended follow-on pass - explicitly instructed to keep going
   rather than stop at that gate - that re-read every web-lane-relevant
   project doc (`docs/FRONTEND.md`, `docs/COMMUNICATION.md`,
   `docs/VALIDATION.md`, `docs/ARCHITECTURE.md`,
   `docs/IMPLEMENTATION_PLAN.md`, `EMBER_LINE.md`) end to end against
   what had actually shipped, specifically hunting for requirements never
   exercised by any test or live check. This found 5 more real,
   previously-invisible bugs (replay focus-on-mount, no keyboard cancel
   for push-to-talk, a narrow-viewport layout bug that made the composer
   unreachable, site damage conveyed by color alone with zero inspection
   path, stale audio outliving the debrief overlay at incident end) -
   each verified bidirectionally (bug reproduced with the fix disabled,
   fix reconfirmed restored), not just checked once. One further
   suspected bug (push-to-talk not stopping at incident end) was
   implemented, then *disproven* live and correctly reverted rather than
   shipped unverified - documented as a deliberate non-change.
8. Document-driven hunting reached genuine diminishing returns (several
   consecutive clean checks: long transcript, high-DPI rendering, two
   push-to-talk reproductions) once every relevant doc had been read.
   From there, this session held a stable, green, fully-verified state
   and monitored periodically for new instructions rather than
   manufacturing further speculative changes.
9. At the user's explicit request, opened PR #5 with an extensive
   description and merge instructions.

## What's deliberately not done, and why

- **Route emphasis and forecast layer** (two Slice 6 exit-gate clauses):
  blocked on `CoordinatorView` having no route/mission-plan or forecast
  field at all. Two contract-change issues (#1, #2) were opened early
  this session with concrete suggested shapes and remain open -
  `packages/domain` was never edited directly to work around this, per
  `AGENTS.md`'s contract-change process.
- **A fire-cell inspection-panel staleness edge case:** architecturally
  plausible (the panel holds a snapshot reference, not a live lookup) but
  no existing scenario or mock data path can trigger it, so it was left
  undone rather than shipped as an unverifiable fix.
- **A real production `vite build`:** pathologically slow in this
  sandbox (no GPU, resource-constrained) and not a CI gate; `vite dev`
  was used for every live verification instead. Flagged in the PR as
  worth a real check before any actual deployment.
- **Rendering performance numbers:** measured and recorded, but
  explicitly labeled as describing this sandbox's software-rendered
  headless Chromium, not real target hardware - never presented as a
  real-hardware claim.

## Handoff

Everything of substance for whoever reviews this next - Andrew, in
particular - is in PR #5's description (what's built, the full list of
14 real bugs found and fixed with commit SHAs, known limitations, CI
status, testing performed, and explicit merge instructions) and, at
finer grain with the reasoning behind every non-obvious decision, in the
log entries above this one in this same file. Nothing is pending beyond
human review: `lane/web` is green, pushed, and PR'd.

# feat/web-scene

Branch `feat/web-scene`, created from the checked-out branch `claude/upbeat-carson-qdm8ud`. That branch already
contains all of `origin/lane/web` plus 58 newer commits from `main` (contract sync, #7), so the PR into `lane/web`
will also show those main commits. Andrew authorised this branch explicitly (AGENTS.md still lists two lanes).

## Setup notes
- `pnpm` via corepack is broken in this VM (cached 12.8.1 ships `pnpm.mjs`, shim wants `pnpm.cjs`). Used the
  installed pnpm 10.28.0 through a wrapper outside the repo. `pnpm install --frozen-lockfile` succeeds.
- Contract status: `packages/domain` on this branch ALREADY has `agentPlans` (#1) and `coordinatorForecast` (#2).
  So item 1 uses the real fields; no local "pending contract" types are needed.
- Item 2 risk: `scenarios/` holds only `scenario-v1.placeholder.json` (all `PENDING`, no coordinates). The synthetic
  topology exists only as code in sim-lane `packages/simulation/src/scenario.ts`. Decision recorded below at item 2.
- Art direction saved at `apps/web/ART_DIRECTION.md`.

### Commit 1: art direction file
Changed: added `apps/web/ART_DIRECTION.md`. Blocked: nothing. Next: item 1 (route + forecast layers).

### Commit 2: item 1 - route emphasis + forecast layers (real domain fields)
Changed: `sceneLayers.ts` (pure builders from `agentPlans` / `coordinatorForecast`), `ribbon.ts` (polyline ribbon
geometry), `patternTextures.ts`, `RouteLayer.tsx`, `ForecastLayer.tsx`, legend toggles + reliability line, labels.
Phase is carried by pattern (chevrons = approach, solid = work, dashes = return) plus label text. Forecast is amber
hatching, ribbon width encodes arrival-time spread, labels give incident-time windows; unreliable/rebuilding is dimmed
and labelled. No "pending contract" shim was needed: `packages/domain` already has both fields.
Self-critique (screenshots 1440x900 + 1024x720): first render's forecast ribbon swamped the route -> narrowed band
(6-16), thickened route (4.5/8). Still off: at 1024x720 the legend covers the route start; fire cells sit far from
roads because the hand-authored map and the 64x64 fire grid use different coordinate frames (item 2 fixes this).
Blocked: nothing. Next: open PR; item 2 (scenario loader).

### Commit 3: item 2 - scenario loader replaces the hand-authored map
Changed: removed the hand-authored topology in `map/scenarioMap.ts`. New `map/scenarioSchema.ts` (Zod),
`map/loadScenario.ts` (first valid `scenarios/*.json` wins; invalid files are skipped with the reason),
`map/activeScenario.ts` (`import.meta.glob` of `scenarios/*.json?strip`), `map/worldScale.ts`, polyline-aware
`map/positions.ts` (roads with `via` bends, heading at the agent's leg), Roads over full polylines.
Fire cells, roads, sites and routes now share one coordinate frame (they did not before).
Decisions (nobody to ask):
- `scenarios/` has only `scenario-v1.placeholder.json`, all `PENDING`, which fails validation (skipped and reported).
  The synthetic topology exists only as code in sim-lane `packages/simulation`. I did NOT import sim packages. A
  one-off script outside the repo generated `map/synthetic-v1.snapshot.json` (topology + public height/fuel grids,
  needed by item 3) from `buildSyntheticScenario()`/`createTerrain()`. It is machine-generated, not hand-authored,
  and is only a fallback: any valid `scenarios/*.json` wins. Needs: someone with sim-lane access to freeze a real
  file into `scenarios/` (then delete the snapshot).
- `requiredWork` (site truth) is stripped from anything read out of `scenarios/` by `scenarioPlugin.ts` before
  bundling, is absent from the Zod schema, and is absent from the snapshot. Tests cover all three.
- New direct dependency: `zod` 3.24.2 in `apps/web` (same exact version as `@ember/domain`, no second copy).
  Why: scenario files are a boundary needing runtime validation and `@ember/domain` does not re-export `z`.
- The frozen fixture and the mock data use `placeholder-*` ids. `net/mockBase.ts` remaps mock views onto the real
  scenario ids (and authors a 4-leg plan, forecast bands and fire cells on the real roads); the fixture is untouched.
- Camera now fits the scene to the canvas on creation (`fitZoom`), and that pose is the reset target.
Self-critique (1440x900 and 1024x720): whole scenario now visible, route/forecast/fire line up on the same roads.
Still off: terrain is the old flat sage/ochre plane (item 3), legend is tall at 1024x720, fire cells are tiny.
PR #8 (open, CI green, no reviews as of 13:01 ET) carries all commits since the branch is the same.
Blocked: nothing. Next: item 3 terrain composition.

### Commit 4: item 3a - terrain heightfield, water, draped roads/routes, dusk lighting
Changed: `terrain/heightField.ts` (public height+fuel grids -> scene ground), `sceneTerrain.ts` (water level + wet
cells that keep 60 units clear of every road/node, tested), `terrainColor.ts` (sage/ochre by vegetation density,
quiet elevation bands), `Terrain.tsx`, draped `Roads.tsx` (constrained segments get a dashed centre marking),
routes/forecast/markers/labels follow ground height, hemisphere fill + warm key + fog.
PR status: #8 was MERGED into lane/web at 17:02Z by Zhang-Andrew888 (first commit only). Andrew then said PRs
must go to main, not lane/web. Next PR: feat/web-scene -> main (branch synced by merge from main and lane/web).
Self-critique: first render was muddy brown with an oversized dark pond and almost no relief. Raised vertical
scale (0.55 -> 0.9), shrank the water quantile (0.07 -> 0.035), more saturated sage, cooler fill, lighter water.
Now reads cool-dusk with ochre patches; still foggy and low-contrast at the far edge, no trees or fire light yet
(3b/3c). Legend is still tall at 1024x720.
Blocked: nothing. Next: merge main + lane/web, open PR to main, then trees (3b).

### Commit 5: item 3b - instanced conifers, quality tiers, camera fit, compact legend
Changed: `trees/` (deterministic placement from the vegetation layer, spatial-hash road/pond avoidance, two merged
species geometries, vertex-shader sway), `Trees.tsx` (one InstancedMesh per species, per-instance tint, char from
OBSERVED fire only), `quality/tiers.ts` (low/medium/high config + reduced-motion override, tested) wired through a
context (tier fixed at "high" until 3d adds auto-pick), camera fit fix (OrbitControls' minZoom 0.6 was clamping the
fit at 1024 wide), legend key collapsed by default under 1280px wide.
Self-critique: first forest was lovely but too busy - canopies sat on top of the forecast hatching beside roads, so I
widened the tree-free road corridor 14 -> 26 units (legibility over decoration). At 1024x720 the legend hid ~40% of
the map and the camera was cropped (zoom clamp); fixed both. Still off: fire cells are tiny squares lost in the
forest (3c: flame cards, ground glow); fog still flattens the far edge.
PR: #12 (feat/web-scene -> main) open; #8 was merged into lane/web earlier.
Blocked: nothing. Next: 3c fire shaders + ground glow/char.

### Commit 6: item 3c - fire as light (flame cards, embers, smoke, ground glow and char)
Changed: `fire/shaders.ts` (hand-written GLSL; no library), `Fire.tsx` (instanced crossed flame cards with additive
blending, rising ember points, faint smoke puffs), `fire/fireMap.ts` + `fireLight.ts` (64x64 observed-only light/char
texture sampled by the terrain and tree materials), `anim/sceneClock.tsx` (one capped 66 ms clock for all decorative
motion under frameloop="demand"), `FireCells.tsx` reduced to flat inspectable ember-bed tiles (the old pulse is gone).
Observed fire only: flames come from observed burning cells, the glow map from observed cells, embers/smoke from fresh
burning cells only. Stale burning = grey hatched static ghost and a quarter of the ground light. Burned = char, no
light. Tests cover: nothing observed -> fully dark map, stale < fresh, burned lights nothing, no flames for
burned/unburned. Fire toggle now governs flames, glow and tree char together. Reduced motion: clock stopped
(uMotion 0), no embers/smoke, flames held steady.
Self-critique (3x crop of the patch): first pass glowed too hot (trees washed pale yellow), pool was boxy, flames
tiny. Switched to a smooth radial falloff over 3 cells, halved the emissive gain (0.55 -> 0.3), raised flames to
1.9 cells tall. Now: soft warm pool, readable flame cards, grey ghosts clearly distinct. Still off: flame/glow have
no bloom yet; far fog flattens the north edge; only 2 live cells in the mock so the effect is modest.
PR: #14 open (3b). Blocked: nothing. Next: 3d post-processing (bloom/vignette/AA), auto quality, dev-only debug panel.

### Commit 7: item 3d - post-processing, auto quality tier, dev-only debug panel
Changed: `RenderPipeline.tsx` (owns rendering at useFrame priority 1; half-float EffectComposer with MSAA, bloom,
OutputPass tone mapping, vignette; plain render when the tier/reduced-motion turns them off), `quality/autoTier.ts`
(p75 of timed frames: down above 36 ms, up below 14 ms after a 6 s cooldown, 60 s ban on a tier just fled; tested),
`quality/qualityStore.ts` (external store for tier mode + scene params), `DebugPanel.tsx` (tier override, colours,
light position, fog, bloom, vignette), soft shadows on the high tier only.
Bloom on fire only: no extra pass; threshold 1.0 on linear HDR, and only the additive fire shaders exceed 1.
No new dependency (three's own examples/postprocessing). Reduced motion and low tier skip bloom + vignette.
Debug panel: loaded only via `import.meta.env.DEV ? lazy(() => import(...)) : null` in SceneView; the guard test
checks that shape and that nothing else writes params/mode. NOT verified against a real production bundle (the brief
forbids a production vite build here) - Andrew should confirm the prod bundle has no `Scene debug` string.
Self-critique: shadows + vignette made it dark and contrasty (ground nearly navy) -> fill light 1.05 -> 1.3. The open
panel covered the map in dev screenshots -> collapsed by default. Result is moody but routes, forecast, crews, labels
stay readable at 1440x900 and 1024x720.
Caveat: the in-app frame timer reads ~2-3 ms in this software-GL VM, which looks too low to trust (GPU process async
even with finish()). Item 7 measures frame time independently with a Playwright script instead.
Blocked: nothing. Next: sync main, PR for 3c/3d, then item 4 (crew + site models).

### Commit 8: item 4 - crew and site models with shape cues
Changed: `models/` (geometry helpers, crew truck with 1..5 tally pegs = crew number, binocular-on-a-post scout, three
site silhouettes: cabin cluster / waterworks / lodge, fence-post ring, rubble, damage gauge), `markerCues.ts` (pure
rules, tested), rewritten `AgentMarkers.tsx` / `SiteMarkers.tsx`, labels now spell the state ("Crew 1 · working").
State cues are shapes AND text: approaching `>>`, withdrawing `<<`, working = spoked ring, retreating = warning
plate, lost = toppled + muted + cross, idle = none. Site protection: unobserved = outline-only ghost, unprotected =
plain, underway = fence-post ring with a gap, destroyed = collapsed rubble; damage is a separate 4-notch gauge.
Agents standing at a site/refuge node are fanned out 92 units beside it (display only) so they never hide a model.
New dev preset `?scenario=model-states` shows all six agent states and sites in three statuses at once.
Self-critique (3x crops): first pass models were 10-20 px, unreadable -> scaled 1.9x / 1.7x. A crew at Ridge Cabins sat
exactly on the cabins and labels covered models -> fan-out + higher label anchors. The legend hid Crew 1/2 at
1440x900 -> key collapsed under 1700 px and toggles laid out in a row. Still off: tally pegs are subtle at fit zoom
(the label and rail carry the number); chevron glyphs are small; legend still overlaps the top-left corner of the map.
Blocked: nothing. Next: item 5 stale-information styling, then 6 camera follow, 7 perf script, 8 replay.

### Commit 9: item 5 - stale-information styling
Changed: `staleness.ts` (age in SIM time; stale after 30 s; opacity fades to 0.35 by 150 s; "never observed" is stale,
not fresh), `staleHatch.ts` (screen-space diagonal hatch patch for any material), agents/sites/fire cells carry
`ageMs`, stale agents and sites fade + hatch + go pale grey, stale flame ghosts dim further with age, labels turn
dashed + italic and say "(seen 1:00 ago)", legend entry says "faded, hatched, age shown". `?scenario=model-states`
now includes a stale crew (60 sim-seconds old).
Self-critique: first hatch made the stale truck almost black and shapeless -> lighter pale-grey stale colour and a
thinner hatch (2.2/7 discarded). Now a stale marker is clearly an older, ghosted copy of the live shape.
Not done / by design: stale information is never hidden - only restyled. The route and forecast layers have no age
of their own in the contract (plans carry no timestamp), so they are not faded.
Blocked: nothing. Next: item 6 camera follow + reset + reduced motion.

### Commit 10: item 6 - camera follow, animated reset, reduced-motion variant
Changed: `cameraMath.ts` (frame-rate independent follow easing tau 80 ms ~ 250 ms settle, snap flag, tween helpers,
pan-gesture test; 11 unit tests), `CameraControls.tsx` rewritten (follow target, animated reset to the fitted pose,
removed the old one-shot focus tween), `SceneView` (selecting an agent starts follow; a pan gesture or the toggle
stops it; Reset also stops follow), legend gets a "Follow selected" checkbox (disabled with a hint when nothing is
selected). Orbit and zoom do NOT stop follow, only pan does. Reduced motion: no damping, follow snaps, reset is
instant. No command controls added: follow/reset only move the camera.
Measured with Playwright (1440x900, model-states preset, label distance from canvas centre, px):
  normal:  before select 264 -> after select 58 (follow on) -> after right-drag pan follow OFF (122) -> after Reset 270
  reduced: before select 264 -> after select 58 (settled in 300 ms) -> pan follow OFF (130) -> after Reset 264
  (~58 px = label sits above the model it is centred on; Reset returns to the fitted framing within label jitter.)
Self-critique: the old selection behaviour recentred once and then lost the crew as it moved; following fixes that.
Reset previously snapped, ignoring the 250 ms rule; now eased. Still off: no keyboard shortcut for reset (the button
is a real DOM button and tabbable); follow does not zoom to fit the agent's route.
Blocked: nothing. Next: item 7 frame-rate script.

### Commit 11: item 7 - repeatable frame-rate script, and the decoration cuts it forced
Script: `pnpm --filter ember-web perf -- [--viewport 1440x900,1024x720] [--tiers low,medium,high] [--seconds 6]
[--machine "<name>"] [--headed] [--real-gpu]` (`apps/web/scripts/perf.mjs`; stats/labelling in the tested
`frameStats.mjs`). It starts the Vite DEV server, opens Chromium at the viewport, starts the incident, forces
continuous rendering with the dev-only `?perfContinuous` flag (impossible in a production build; tested), selects each
tier through the debug panel, records requestAnimationFrame intervals (= sustainable frame time under continuous
rendering) and writes `apps/web/perf-results/perf-<time>.json`. The label is automatic: a software WebGL renderer is
ALWAYS "cloud VM, headless Chromium, software rendering, not representative"; a real GPU run without `--machine` is
flagged UNNAMED and exits 2. Playwright is not a repo dependency (resolved locally, else from the global npm root).

RESULTS - cloud VM, headless Chromium, software rendering, not representative
(ANGLE / SwiftShader, 6 s per tier, target = 30 fps = 33.3 ms; files in perf-results/):
  BEFORE the cuts (perf-2026-10-03T18-00-17):  low 5.2 fps (191 ms) | medium 1.5 fps (675 ms) | high 0.95 fps (1047 ms)  @1440x900
                                                low 7.4 fps (136 ms) | medium 2.4 fps | high 1.3 fps                    @1024x720
  AFTER  the cuts (perf-2026-10-03T18-05-24):  low 12.5 fps (80 ms; p95 117) | medium 1.6 fps (630 ms) | high 1.1 fps (945 ms)  @1440x900
                                                low 20.3 fps (49 ms; p95 83) | medium 2.8 fps | high 1.3 fps                  @1024x720
TARGET MISSED at every tier on this VM. That says almost nothing about real hardware: the VM has no GPU.
ANDREW MUST RUN THE SAME SCRIPT ON HIS OWN NAMED MACHINE, e.g.
  pnpm --filter ember-web perf -- --machine "<model, GPU, OS>" --real-gpu --headed
and quote only that result. Until then no frame-rate claim holds for real hardware.

Decoration dropped first (profile on the low tier, mean frame ms, removing one layer at a time, 1440x900):
  everything 212 | no trees 81 | no terrain 145 | no roads 186 | no fire 186 | none of the four 32.
  -> low tier now: tree density 0.3 -> 0.12 with a single-cone tree, Lambert instead of PBR for ground and trees,
     render scale 0.75 (labels are DOM so stay crisp). Re-profile: all 79 | no trees 58 | no terrain 48 | no roads 75 |
     no fire 76 | none 30 (the ~30 ms floor is canvas + markers + DOM in software GL).
  -> medium: tree density 0.65 -> 0.45, Lambert. Bloom/MSAA/shadows are the software killers on medium/high; they stay
     because a real GPU should afford them - the auto tier steps down if it cannot.
Product-critical layers (routes, forecast, crews, sites, observed fire, labels) are identical on every tier (checked by
screenshot of the low tier: all readable, forest simply sparser).
Caveat carried from 3d: the in-app timer (RenderPipeline) under-reads in software GL; this script is the number to use.
Next: item 8 replay (truth only there).

### Commit 12: item 8 - replay mode that reveals the full fire (the only place truth may appear)
Contract fact: `packages/domain` has NO truth channel (and must not get one in the live types). So truth is declared as a
separate, LOCAL, replay-only schema in `apps/web/src/replay/`: `ReplayRecording` = `{ coordinatorLog, truthFrames }`
(strict Zod; frames are {timeMs, burning[], burned[]} cell indices, mirroring the shape of the sim lane's reveal output
without importing any sim-lane package). `mockRecording.ts` is a hand-authored deterministic mock log (rectangles of cells
growing north-east of the briefed ignition patch; it is data, not a spread model) whose final frame has 84 cells vs the 6
the coordinator ever observed. `truthGate.truthForDisplay` is the single gate: it returns a frame only for
phase === "replay" AND the explicit "Replay: full simulated fire" toggle (default off). `mergeTruthCells` overlays truth
on the observed cells; truth cells the coordinator never saw are `unseen` (dashed violet frame, legend entry, inspection
text, banner wording).
PROOF (apps/web/src/replay/liveNeverCarriesTruth.test.ts, 40+ cases):
  1. every live payload (fixture, authored snapshots, every ?scenario= preset, ended views) passes
     `CoordinatorView.strict()` and a deep key scan for truth keys (burning, burned, truthFrames, cellState,
     ignitedAtMs, unseen, privateWorldParameters, requiredWork, ...);
  2. what the mock socket actually EMITS (fake timers, through the production wire parser) is truth-free, default demo
     and every preset;
  3. the wire client strips a truthFrames/privateWorldParameters field a server might add;
  4. the display gate returns null for briefing/live whatever the toggle and returns a frame only in replay+toggle;
  5. source guard: only components/ReplayView.tsx imports replay/{recording,mockRecording,truthGate}; App.tsx never
     imports replay/; live fire cells never carry `unseen`.
  Mutation-checked: removing the gate's phase check, adding a truth key to the live socket, and importing the gate from
  App.tsx each make the intended tests FAIL (then reverted).
Screenshots (1440x900 and 1024x720, replay at 5:00): toggle off = 6 observed cells, stale agents "seen 3:30 ago";
toggle on = flames/glow/char over the whole fire with dashed frames on the 78 never-observed cells. Console clean.
Self-critique: the legend list said "Observed cells (84)" with truth on, which was a lie -> now "84 cells (6 observed,
78 never observed - replay only)". The mock fire is a boxy rectangle (fine for mock data). Replay does not yet interpolate
between snapshots or animate the spread between events; it steps by event.
Blocked: nothing. Next: self-review of the whole diff (dead code, bugs, missing tests), then the final summary.

## feat/navigation (2026-10-03)

Branch: `feat/navigation` on `main` @ web-ui merge (`e458ab4`).

- **Approach routes:** `enumerateApproachRoutes` in `packages/navigation` — BFS over edge bans (up to 6 polylines) so mission `candidates` can include south and north corridor approaches when both certify.
- **Calibration (not RL):** `NAV_CALIBRATION_PRESETS`, `nav-calibration-cli.ts`, `packages/navigation/README.md`; `DEVELOPMENT.md` offline section.
- **Exploratory report:** `apps/server/evaluation-results/nav-calibration-exploratory.json` — `ember_line` × 5 dev seeds × 6 presets. No crew losses on any preset; `buffer-loose` slightly lower mean work (642.4 vs 648.4) on this batch — **not** adopted into defaults (dev-only sweep per docs).
- **CI:** 711 tests green after merge with main.

### Commit 13: self-review of the whole diff (own pass + independent code-review over 16b82c4..HEAD)
Method: a mechanical unused-export scan, a manual read, then the code-review skill over the full range. Fixed, each with a
test or a measurement where one is possible:
- DEAD CODE removed: the `fireLightUniforms` re-export in Fire.tsx, the unused `ring()` geometry helper, the unused
  `worldMeters` parameter of `createHeightField`, a no-op shader branch in fireLight.ts, a clumsy `--real-gpu` filter.
- BUG: route/forecast labels stayed on screen when their layer was toggled off (labels memo ignored the toggles).
- BUG (truthfulness): in replay, a truth cell that replaced a stale/different observation was built as `stale:false,
  ageMs:0, unseen:false`, so it read "last observed (0s ago)". It is now `unseen` (dashed frame, "not observed"); tests added.
- BUG/RISK: `resolveGridCellPosition` hard-coded a 64x25 m grid while terrain, fire light and tree char used the scenario's
  grid. It now takes the scenario map; a test uses a 32x50 m grid to prove it follows the scenario.
- BUG: the middle mouse button (zoom in OrbitControls) paused follow and touch panning never did. `isPanGesture` now matches
  OrbitControls (right button, modifier+left, two fingers); tests added.
- PERF: RenderPipeline wrote frame timing into the React store every 4th frame in production, re-rendering the whole Canvas
  tree. Timing now lives in its own store, written only in dev builds; only a tier change touches the main store (tested).
- LEAK: Fire.tsx replaced instanced attributes on a shared geometry, leaving GPU buffers allocated. Each flame/smoke set now
  has its own geometry, disposed when replaced. (Reasoned from three's buffer lifecycle; not measurable from here.)
- UX: clicking the already-selected agent on the map after a pan now resumes follow.
- CLEANUP: stale materials (agents, sites) moved from mutate-in-render to a `useStaleMaterial` hook with an explicit repaint
  request. I TRIED to prove this fixes a missed repaint in reduced motion (new dev preset `?scenario=stale-transition`):
  the canvas repainted WITH and WITHOUT the explicit request (other layers also request a frame on each snapshot), so this is
  defensive cleanup, NOT a demonstrated bug fix.
Not mine, reported only (pre-existing `lane/web` code in `App.tsx`; outside the brief, so not touched):
  1. with `VITE_INCIDENT_REST_BASE_URL` set, Start always creates a new incident and ignores the preconfigured
     `VITE_INCIDENT_WS_URL`/`VITE_INCIDENT_ID`/`VITE_INCIDENT_TOKEN`, contradicting `.env.example`;
  2. a failed `createIncident` leaves Start doing nothing and shows no error;
  3. the "Received: ..." speech plays even when the socket is not open (the `say` is dropped), and `crypto.randomUUID()` throws
     on plain-http non-localhost pages.
Still no test for: GL components (RenderPipeline, Trees, Fire, markers - the repo has no DOM/GL test environment; verified by
screenshot and the Playwright scripts), the Vite plugin's `load` hook (its pure core, `stripPrivateFields`, is tested).

## feat/web-scene - FINAL SUMMARY (written 14:3x ET; nothing further planned)

State: all 8 brief items implemented, tested and verified (Playwright screenshots or measurements, recorded above). Every
commit passed `pnpm typecheck && pnpm lint && pnpm test`. PRs went to `main` (not `lane/web`) after Andrew said so mid-run:
#8 (lane/web, item 1, before that instruction), #12, #14, #16, #20, #23, #25 merged by Zhang-Andrew888; the closing review-fix PR
is the last one. The branch was always synced by merging `origin/main` (no rebase, no force-push).

| # | Item | Verified by |
|---|---|---|
| 1 | Route emphasis + forecast (uncertainty) layers | real `agentPlans`/`coordinatorForecast` fields (domain already had them); screenshots |
| 2 | Scenario loader replaces hand-authored map | Zod loader + tests; one generated fallback snapshot (see below) |
| 3 | Terrain: elevation, vegetation, roads, water (+ art direction: trees, fire light, bloom/vignette/AA, tiers, dev panel) | screenshots 1440x900/1024x720, tests |
| 4 | Crew/site models, non-colour state cues | `?scenario=model-states` crops, tests |
| 5 | Stale styling (fade, hatch, age) | `?scenario=model-states` crops, tests |
| 6 | Camera follow, reset, reduced motion | Playwright measurements (normal + reduced) |
| 7 | Frame-rate script | ran it; numbers below |
| 8 | Replay reveals full fire; truth only there | `liveNeverCarriesTruth.test.ts`, mutation-checked; screenshots |

PENDING ON CONTRACT / OTHER LANES (nothing in packages/domain was edited):
- Route + forecast need no contract change any more (#1/#2 are in the domain). They carry no timestamps, so those layers cannot show their own staleness.
- `scenarios/` still holds only the all-`PENDING` placeholder. The map therefore loads `apps/web/src/map/synthetic-v1.snapshot.json`,
  generated once from the sim lane's synthetic scenario (topology + public height/fuel grids; `requiredWork` removed). Someone with
  sim-lane access should freeze a real scenario file into `scenarios/` (it wins automatically if valid); then delete the snapshot.
- There is no truth/replay channel in the contract. Replay uses a LOCAL strict schema (`replay/recording.ts`) matching the shape of the
  sim lane's reveal output; reconcile it when the server's replay endpoint exists.
- New direct dependency: `zod` 3.24.2 in apps/web (same version as @ember/domain; `@ember/domain` does not re-export `z`).

FRAME RATE - cloud VM, headless Chromium, software rendering, not representative (SwiftShader; target 30 fps = 33.3 ms), final:
  1440x900: low 12.5 fps (80 ms, p95 117) | medium 1.6 fps | high 1.1 fps     1024x720: low 20.3 fps (49 ms) | medium 2.8 | high 1.3
  TARGET MISSED at every tier on this VM. ANDREW MUST RUN THE SAME SCRIPT ON HIS OWN NAMED MACHINE:
  `pnpm --filter ember-web perf -- --machine "<model, GPU, OS>" --real-gpu --headed` - only that result may be quoted.
  Decoration was already dropped first (see commit 11). The review-fix commit does not change rendering cost.

THINGS I COULD NOT VERIFY (be sceptical of these):
- A production bundle: no production vite build was run (the brief forbids it). The debug panel and `?perfContinuous` are guarded
  by `import.meta.env.DEV` and tested at source level only; confirm the prod bundle has no "Scene debug" string.
- The GPU-buffer leak fix (commit 13) is reasoned from three's buffer lifecycle, not measured.
- The in-app frame timer reads implausibly low in software GL; use the perf script, not that readout.
- Real-GPU appearance and speed of bloom, MSAA and shadows: unknown until Andrew's run.

Pre-existing issues seen in `App.tsx` (lane/web code, not touched): start flow ignores preconfigured WS env vars when the REST base
URL is set; failed `createIncident` is silent; "Received:" speech plays when the socket is closed and `crypto.randomUUID()` can throw
on plain-http pages. Details in commit 13.

Environment notes: corepack's cached pnpm 12.8.1 is broken in this VM; pnpm 10.28 was used through a wrapper outside the repo.
Playwright is not a repo dependency (the perf script resolves it locally or from the global npm root).

### Debugging pass: the auto quality tier never stepped down (found by checking the unverified timer)
Reproduced: with `?perfContinuous` on high, the in-app readout said 4.5 ms while real frames took ~1037 ms. Root cause:
`gl.getContext().finish()` returns immediately under ANGLE/SwiftShader, so RenderPipeline timed only the CPU submit and the
auto tier (which trusts that number) would never have stepped down on a weak machine.
Fixes: (1) timing now forces a sync with a 1-pixel `readPixels` (`waitForGpu`); readout became ~3000 ms vs ~1100 ms real, i.e. the
right order of magnitude and over budget. (2) a fast path in `autoTier`: 4 consecutive frames over 72 ms step down at once,
because a 1 fps machine would otherwise take minutes to fill the 24-sample window (3 new tests, 2 old ones updated for the new
intent). Verified end to end in auto mode on this VM: high -> medium at 13 s -> low at 23 s (before: stayed on high).
Also checked: PR #30 CI all green (Lint, Typecheck, Test).

### Debugging pass 2: start-flow fixes, tested against the REAL apps/server
Re-checked the three `App.tsx` issues against the current code: the "Received:" speech one was already fixed by someone else's
refactor (speech is receipt-driven now). Fixed the other two plus the third bug in that file:
- Pre-configured WebSocket ignored: `net/startPlan.ts` (`planStart`, tested) - a `VITE_INCIDENT_WS_URL` means "skip POST /incidents"
  as `.env.example` says; the REST base is then only used for `POST /incidents/:id/start`.
- Silent failure: a failed `createIncident` now shows a `role="alert"` message on the briefing screen.
- `crypto.randomUUID()` threw on plain-http pages: `net/commandId.ts` falls back to `getRandomValues`, then `Math.random` (tested).
Integration test (apps/server `src/dev-http.ts` on :3000 + three Vite instances, Playwright recording the actual requests):
  A REST only            -> POST /incidents, POST /incidents/<new>/start, WS to the new incident, reached live  (unchanged)
  B pre-configured WS    -> NO POST /incidents; POST /incidents/<configured id>/start; WS to the configured incident, live
  C unreachable REST     -> alert "Could not create the incident...", stayed on the briefing screen
Real-server scene check: server node ids (n-rw, ...) match the snapshot, so crews, 4-leg routes, forecast bands and sites all
resolve; console clean. It also exposed two legibility problems the mock never showed, both fixed:
- the real forecast has ~10 bands each with a very wide window label ("7:00-30:35"), burying the map -> only the 3 soonest bands
  are labelled (`labelledBands`, tested); the rest stay as hatching;
- route labels showed raw `work_interval_limited_by_forecast` -> `humanizeReason`.
Observation, not a bug: sites read "stale, seen 0:49 ago" at t~1 min because their briefed observation (t=0) is >30 sim-s old.
That is the staleness rule working; whether briefed site data should ever count as stale is a product question for Andrew.
