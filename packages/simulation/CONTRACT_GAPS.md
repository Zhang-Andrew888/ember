# Contract gaps (GitHub issue #3)

Found while implementing Slices 1–4 on `lane/sim`. **`packages/domain` is read-only for agents**; changes go through a `contract`-labelled issue and human merge to `main`. This file is the sim-lane source of truth for status, workarounds, and proposed schema updates.

Related coordinator-view gaps: issue **#1** (sanitized route/plan emphasis), **#2** (forecast ensemble/uncertainty in `CoordinatorView`).

| # | Topic | Status on `main` | Workaround in code |
|---|--------|------------------|---------------------|
| 1 | `AgentState` too coarse vs docs/NAVIGATION_AGENTS.md | **Open** | Truth uses domain enum; rich lifecycle in `@ember/agents` `ControllerState`. Coordinator `agentPlans[].phase` carries approach/work/return; returning/stranded/holding/planning collapse to `idle`/`approaching`. See `World.refreshState` and `contract-gaps.test.ts`. |
| 2 | Cell observations road-centric | **Closed** | `ObservedField` `kind: "cell"` uses `gridCellIndex` (64×64 row-major). Legacy pseudo edge `"grid"` is removed. |
| 3 | `ObjectiveKind` missing doc kinds | **Partial** | `avoid_corridor` is in domain. **Open:** `resume_autonomous` — use `CrewController.resumeAutonomous()` and gateway `"resume"` intent (not an `ObjectiveKind`). Internal avoid-edge sets for corridor bans. |
| 4 | `SimulationAPI` not implementable as written | **Open** | **`Incident`** (absolute due time in `advanceTo`), **`RunRecord`** + **`replayRecord`**, **`revealFire`** in `@ember/replay`. Do not call `evaluateMission` / `replay(log)` from the domain interface. |
| 5 | `DecisionType` vs forecast contradiction/rebuild | **Open** | `@ember/forecast` emits `ForecastEvent` (`contradiction`, `rebuild_complete`, `rebuild_failed`) on controller tick output; not serialized as `DecisionEvent`. |

## Proposed domain changes (for contract review)

1. **AgentState** — extend enum (or add optional `lifecyclePhase` on coordinator agent view only) so coordinator UI can distinguish holding, planning, returning, stranded from generic idle/approaching without exposing truth.
2. ~~**ObservedField cell**~~ — done (`gridCellIndex`).
3. **ObjectiveKind** — add `resume_autonomous` (or document `"resume"` as a command-only intent forever).
4. **SimulationAPI** — replace `replay(log: DomainEvent[])` with record-based replay; remove or relocate `evaluateMission` (planning lives in `@ember/navigation` + session wiring); document `advance` as absolute `SimTimeMs` due time.
5. **DecisionType** — add codes (or a parallel `ForecastDecisionEvent` schema) for contradiction/rebuild visibility in bundles and replay metrics.

## Where to look

- Projections: `packages/simulation/src/incident.ts` (`projectCoordinator`, `projectAgent`)
- Truth state enum: `packages/simulation/src/world.ts` (`refreshState`)
- Controllers: `packages/agents/src/controller.ts`, `packages/agents/src/types.ts` (`ControllerState`, `TickOutput.forecastEvents`)
- Replay: `packages/simulation/src/record.ts`, `packages/replay/src/reveal.ts`
- Tests: `packages/simulation/src/contract-gaps.test.ts`, `packages/agents/src/contract-gaps.test.ts`
