# Overnight log - sim lane

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

## Known gaps

- Slice 5 conversation, Slice 7 comparison harness, failure injection and the scripted coordinator policy: see below
  for what landed.
