# Overnight log - lane/web

Autonomous overnight session. No one is available to answer questions;
decisions below were made unilaterally and are recorded here for review.

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
