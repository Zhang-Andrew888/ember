# Implementation plan

This document keeps the original ordered backlog and acceptance gates. **Implementation status** (after ~117 commits merged 2026-10-03) is summarized below; the slice sections still describe intent and exit criteria.

## Implementation status (2026-10-03)

| Slice | Summary | Status |
|---|---|---|
| 0 | Provider spike, real map extract, mic/TTS proof | **Open** — no xAI keys or OSM crop in repo; synthetic scenario + `ScriptedInterpreter` stand in |
| 1 | Seeded incident, clock, debrief, event log | **Done (sim)** — `packages/simulation`, `packages/replay`; **web** — briefing, end overlay, mock/live hooks |
| 2 | Knowledge, forecasts, filtered views | **Done (sim)** — `packages/knowledge`, `packages/forecast`, coordinator projections tested |
| 3 | Mission search, autonomy, retreat | **Done (sim)** — `packages/navigation`, `packages/agents` |
| 4 | Full team, reservations, scout | **Done (sim)** — session wiring in `apps/server`; synthetic graph includes second approach road |
| 5 | Full Grok conversation | **Partial** — `packages/communication` + server bridge with **no-provider** adapter; validation cases 1–15 covered in tests except real mic/provider |
| 6 | Three.js experience | **Mostly done (web)** — scene, a11y, PTT stub, replay view, dev `?scenario=` presets; **blocked:** route emphasis and forecast layer need domain fields (contract issues #1, #2) |
| 7 | Replay, evaluation, demo | **Partial** — bundle replay, metrics, three-variant harness, failure injection, JSON reports; **open:** two-minute rehearsed demo assets, real provider sessions |

**CI:** `pnpm typecheck`, `pnpm lint`, and `pnpm test` run in GitHub Actions. Test counts grew with both lanes (sim lane ~268 tests at handoff; web lane ~132; shared packages overlap—run locally for current totals).

**Where to look:** [SERVER_AND_EVALUATION.md](SERVER_AND_EVALUATION.md), [apps/server/README.md](../apps/server/README.md), [OVERNIGHT_LOG.md](../OVERNIGHT_LOG.md).

No development deadline or team capacity was supplied; use acceptance gates rather than a fabricated schedule. The scope is fixed by [the product specification](../EMBER_LINE.md).

## Slice 0 — integration and data proof

Build the smallest browser/server harness needed to verify the external assumptions.

- Render a Three.js scene in the React/Fiber major pairing; measure the development machine baseline.
- Prove microphone capture, release-to-commit, typed interpretation, schema-validated tool output, and exact-text TTS with the configured xAI account.
- Test urgent audio queued while recording and suppression of provider-generated unsolicited speech.
- Acquire the real road extract from the selected region; choose a connected crop satisfying the scenario geometry gate.
- Pin package/provider model versions and record map/configuration hashes.
- Keep secrets server-side and make a no-provider test adapter for deterministic development.

**Exit gate:** a spoken named-recipient command yields a validated mock receipt; urgent audio starts after release; the real graph has the required alternatives. Account/model availability and map node IDs are resolved here. No model access has been verified by this documentation task.

## Slice 1 — one visible complete incident

Implement the fixed clock, seeded fire, one crew, one site, one refuge, work, damage, crew loss, and end evaluation. Use Three.js from the first visible slice, with readable labels and a simple DOM transcript.

Use authored commands in the harness temporarily; do not expose permanent map command controls. Save ordered events and scenario seed/configuration. Add a real-time start screen and stopped debrief.

**Exit gate:** the same input log reproduces the same result; the five-minute wall limit maps correctly to incident time; no rendering or provider delay changes the world clock.

## Slice 2 — knowledge and forecasts

Add local observations, the coordinator projection, per-agent histories, forecast ensembles, uncertainty display, and broader recovery after contradiction. Remove truth data from active client payloads.

**Exit gate:** a coordinator-only observation cannot affect a crew plan; stale “clear” observations do not become current clearance; an empty/contradicted ensemble admits no protection work. Replay alone can reveal the full fire.

## Slice 3 — mission planning and autonomous behavior

Implement time-expanded approach/work/return search, partial missions, buffer checks across every retained member, edge-position replanning, reversal, automatic withdrawal, retreat, and independent mission selection.

**Exit gate:** an intentionally infeasible one-member case is rejected; a shorter work interval may pass; a changing forecast causes autonomous departure without approval. No-feasible-return attempts escape instead of continuing work or waiting for a user.

## Slice 4 — full team and shared roads

Add three crews, the ground scout, three sites, additive work, shared progress, automatic reservations, safe yielding, and information-driven scout choice. Implement all accepted loss/end cases.

**Exit gate:** crews cannot occupy the single-capacity corridor simultaneously; an unsafe yield is rejected; scout observations improve only the coordinator until relayed; surviving scout alone does not keep the incident running.

## Slice 5 — complete conversation

Connect the proven provider adapter to the real gateway, evidence resolver, and planner. Add persistent addressed recipient, clarification, rejected objectives, status queries, exact outcome-based speech, and radio phrasing preference.

**Exit gate:** complete the text/voice scenarios in [validation](VALIDATION.md). Repeated commands are idempotent, delayed interpretations use current state, and urgent reports cannot retarget a captured utterance.

## Slice 6 — finished Three.js experience

Complete terrain composition, crew/site models, observation/forecast layers, route emphasis, camera following, stale information styling, accessible controls, urgent strip, briefing, and debrief.

**Exit gate:** the map explains a route change without exposing unknown fire; inspection never issues commands; all product-critical states remain legible at the target viewport and reduced-motion setting. Meet measured rendering targets by reducing decoration first.

## Slice 7 — replay, comparison, and demo

Complete event replay, held-out seed evaluation, scripted coordinator policy, failure injection, and the two-minute presentation. Export actual results, runtime measurements, scenario hashes, and representative failures.

**Exit gate:** every mandatory validation case passes, performance is measured on a named machine, and the demo can explain both the navigation benefit and its limits. No fabricated baseline wins.

## Work organization

The model/navigation slices are the critical dependency chain. UI scene work and the provider spike can proceed independently against recorded fixtures, but integration always uses the same contracts. Do not create competing simulation implementations in frontend and backend.

Each slice should land as a reviewable change containing behavior, necessary checks, and a short demo fixture. Keep test fixtures small and exact; build broad randomized evaluation after deterministic invariants work.

## Priority if capacity is constrained

Preserve the active simulation, per-agent knowledge, full mission feasibility, autonomous survival behavior, text plus Grok voice, and Three.js GUI.

Reduce in this order: decorative scene detail, number of scouting points, map extent, route alternatives beyond those needed for the scenario, additional evaluation seeds beyond the initial held-out batch. Changing grid/forecast sampling requires versioning and revalidation; never discard dangerous hypotheses for a better success rate.

If the complete release gate cannot be reached, label the build as a partial prototype and list missing slices. A text-only build or a flat placeholder scene does not satisfy the requested final MVP.

## No pending product questions

Initial constants are selected in [simulation](SIMULATION.md) and [navigation](NAVIGATION_AGENTS.md). Runtime interfaces, provider topology, GUI, and framework choice are selected in the other documents. The remaining work is implementation and validation: source-map extraction, API capability testing, code, benchmarks, scenario calibration, and UX testing.
