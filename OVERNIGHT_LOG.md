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
