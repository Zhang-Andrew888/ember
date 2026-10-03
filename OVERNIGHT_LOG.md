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
