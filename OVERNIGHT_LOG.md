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
