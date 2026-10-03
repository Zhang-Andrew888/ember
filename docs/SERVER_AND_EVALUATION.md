# Server, live session, and offline evaluation

This document describes what exists in `apps/server` and related packages after the sim-lane implementation merge (~117 commits through 2026-10-03). It complements [architecture](ARCHITECTURE.md) (intended contracts) with the current code path.

## What runs today

| Component | Location | Role |
|---|---|---|
| Authoritative world | `packages/simulation` (`Incident`) | Fixed-step fire, movement, work, damage, endings |
| Per-agent controllers | `packages/agents` | Objectives, withdrawal, retreat, scout |
| Reservations | `packages/navigation` | Single-capacity segments, verified yielding |
| Conversation (no provider) | `packages/communication` + `apps/server/conversation.ts` | Gateway, `ScriptedInterpreter`, audio scheduler, push-to-talk |
| Live loop | `apps/server/runner.ts`, `hub.ts`, `ws-server.ts` | Monotonic clock, 200 ms pump, validated WebSocket messages |
| Offline evaluation | `apps/server/evaluation.ts`, CLIs | Three policy variants, held-out seeds, failure injection |
| Replay | `packages/replay` | Run records, bundle replay, full-fire reveal, metrics |

Provider keys are not required for development or CI: interpretation uses `ScriptedInterpreter`; speech uses a recording sink. Real Grok Voice integration remains [Slice 0 / provider work](IMPLEMENTATION_PLAN.md).

## Live WebSocket server

`startServer()` in `ws-server.ts` binds a **loopback-only** WebSocket server. The simulation advances on a monotonic clock every 200 ms regardless of client count; a slow reader only delays its own outbound queue (there is no backpressure cap on unread data—acceptable for local demo, not for production).

**Client → server** (`protocol.ts`, Zod-validated, max frame 64 KiB):

- `say` — typed command with idempotency key
- `ptt_begin`, `ptt_release`, `ptt_lost_focus` — push-to-talk lifecycle (transcript on release)
- `resend` — resend last unsent utterance
- `inspect` — map inspection; does **not** change the addressed recipient

**Server → client:** `view` (`CoordinatorView`), `transcript`, `receipt`, `decision`, `audio`, `notice`, `ended`, `inspection`.

Every outbound message is built from sanitized projections. Automated tests scan full runs and real sockets for private world seed, private spread parameters, and truth fire state.

## REST transport (partial)

[ARCHITECTURE.md](ARCHITECTURE.md) lists HTTP routes (`POST /incidents`, `POST /incidents/:id/start`, `GET /incidents/:id/replay`, separate voice WebSocket). **Only the WebSocket hub above is implemented end-to-end on the server today.** The web app can call `POST /incidents/:id/start` when `VITE_INCIDENT_REST_BASE_URL` is set; otherwise it uses mock fixtures and local replay logs. Fastify is a dependency but not yet wired as the public HTTP front door.

## Offline evaluation

Three variants share the same scenario, seeds, and scripted coordinator policy (`ScriptedCoordinatorPolicy`, version `scripted-relay` v2):

1. **Dispatch baseline** — shortest useful work without forecast-based mission admission
2. **Forecast, no scout** — full planner, scout stays at refuge
3. **Ember Line** — planner plus active ground scout

Commands (from repo root):

```sh
pnpm --filter ember-server exec tsx src/evaluate-cli.ts heldout out.json   # 20 held-out seeds × 3 variants
pnpm --filter ember-server exec tsx src/evaluate-cli.ts dev out.json       # 5 development seeds
pnpm --filter ember-server exec tsx src/evaluate-cli.ts showcase out.json  # rehearsed seed
pnpm --filter ember-server exec tsx src/sensitivity-cli.ts out.json        # exploratory prior-width study
```

A full held-out run takes on the order of **16 minutes on four cores**. Recorded JSON reports live in `apps/server/evaluation-results/`. Read caveats in each file and in [OVERNIGHT_LOG.md](../OVERNIGHT_LOG.md) before quoting headline numbers.

### Measured outcomes (held-out batch, synthetic scenario)

Reported from `heldout-20-seeds.json` (see `measuredAtCommit` / `measuredAt` in the file). Scenario hash `9c5ecd71…`.
Re-run the held-out CLI on current main before quoting; older snapshots (e.g. **7b2832d**) differed on forecast work (~635 vs **600** now).

| Metric (20 seeds, mean unless noted) | Dispatch | Forecast, no scout | Ember Line |
|---|---:|---:|---:|
| Protection work delivered | 802.5 | 600 | 600 |
| Sites protected and standing (of 3) | 1.45 | 1.00 | 1.00 |
| Sites destroyed | 1.2 | 1.3 | 1.3 |
| Crews lost (total over 20 runs) | 11 | 0 | 0 |

Interpretation (honest):

- The no-forecast baseline delivers more work and saves more sites but **loses crews**; forecast planning trades productivity for safety on this scenario.
- **Scout showed no measurable benefit** here (600 vs 600 work): crews independently pick the same site at t=0, finish early, then often have no admissible mission; the scripted policy relays only and does not allocate.
- Authoritative step **p95 is 0–1 ms** in the held-out harness (exact percentile, not “under 1 ms”); **max step 3 ms** in the latest run. Replanning p95 ~7–24 ms in that run (target &lt; 500 ms met). Contradiction rebuilds can take 1–4 s in single-threaded offline runs; production should keep heavy forecast work off the step thread.

Performance and failure excerpts are also embedded in `heldout-20-seeds.json` (`failures`, timing fields). For the two-minute demo closing, run `scripts/demo.sh --comparison` — **do not** use `showcase-seed.json` for variant comparison (rehearsal seed only). Safety examples: dispatch crew losses on **heldout-15** (3 crews), **heldout-18** (2), **heldout-19** (2 + stranded).

## Scenario validation CLI

Scenario JSON can be checked without starting a server:

```sh
pnpm --filter ember-server exec tsx src/check-scenario-cli.ts path/to/scenario.json
```

This runs `validateScenario` (referential integrity, connectivity, ignition placement) and `scenarioGates` (the five geometry acceptance constraints from [SIMULATION.md](SIMULATION.md)). The **authored synthetic graph** in `packages/simulation/src/scenario.ts` passes all gates. `scenarios/scenario-v1.placeholder.json` is intentionally incomplete and should fail until a real map crop is authored.

## Deviations from the original architecture sketch

Documented here so readers do not hunt the codebase for modules that were merged differently:

- **`reservations`** live in `packages/navigation`, not a separate package.
- **`SimulationAPI`** from early docs is not a single class; use `Incident`, `replayRecord`, `revealFire`, and session-level wiring instead.
- **Cell observations** use pseudo edge id `"grid"` with flat cell index (domain `ObservedField` is road-centric); contract issue tracked for a cleaner shape.
- **Scenario geography:** MVP code uses the synthetic graph (including a second south-east road added so three crews can work), not the Oakland OSM extract described in [SIMULATION.md](SIMULATION.md).

## Related reading

- Package-oriented command summary: [apps/server/README.md](../apps/server/README.md)
- Slice exit gates and test pointers: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
- Invariant and E2E checklists: [VALIDATION.md](VALIDATION.md)
- Agent session log with commit-level detail: [OVERNIGHT_LOG.md](../OVERNIGHT_LOG.md)
