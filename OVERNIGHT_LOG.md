# Overnight log - lane/web

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
