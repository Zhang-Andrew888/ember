# Validation, evaluation, and demo

This document is the acceptance checklist. **Much of the model and communication matrix is covered by Vitest** in `packages/*` and `apps/server`; the web lane added unit tests and manual/browser verification documented in [OVERNIGHT_LOG.md](../OVERNIGHT_LOG.md). **Held-out evaluation runs exist** (`apps/server/evaluation-results/`); read [SERVER_AND_EVALUATION.md](SERVER_AND_EVALUATION.md) for numbers and caveats. Real Grok/microphone smoke tests and Playwright screenshot gates are still open items from Slice 0/6.

## Verification status (2026-10-03)

| Area | Coverage |
|---|---|
| Model invariants (table below) | Broad Vitest coverage; `packages/simulation/src/fuzz.test.ts` randomizes command order for six seeds |
| Reservation and autonomy | `packages/navigation`, `packages/agents`, `apps/server/src/session.test.ts`, chaos/robustness tests |
| Communication cases 1–15 | `packages/communication` + server conversation tests; **not** live provider or microphone |
| Frontend/information checks | Web lane: schema-validating client, dev scenario presets, a11y fixes, mock PTT; **no** automated Playwright suite in CI yet |
| Performance targets | Measured in offline evaluation harness (step p95, replan p95); client FPS measured in sandbox only—see OVERNIGHT_LOG |
| Fair comparison protocol | Implemented as `runEvaluation` three variants + `ScriptedCoordinatorPolicy` v2; JSON reports on disk |
| Two-minute presentation | Not packaged as release artifact |

## Required model invariants

| Case | Expected result |
|---|---|
| Same seed, configuration, and applied-command log | Identical fire, movement, work, losses, and terminal snapshot |
| Render frame rate changes | No change to authoritative outcomes |
| One retained future fails a return | That complete mission is rejected or shortened/rerouted |
| Empty or contradicted ensemble | No protection admission; unreliable state and broader rebuild |
| Hidden-world parameter changes without new evidence | Crew input hash and immediate decision remain unchanged |
| Coordinator receives a scout observation | Other crews remain unchanged until targeted relay |
| Older “road clear” relay conflicts with fresh local fire | Fresh local hazard controls planning |
| Unsupported coordinator claim | No hazard removed and no fabricated observation created |
| Two working crews | Work grows by their summed rates; never beyond required work |
| Crew leaves and another arrives | Progress retained; only current workers contribute |
| Partial protection | Linear reduction in subsequent damage rate |
| Exposure ceases | New fire damage stops; accumulated damage remains |
| Site destroyed | No further useful work; failed outcome retained |
| All sites complete/destroyed | Immediate end, even with agents away from refuge |
| All protection crews lost, scout alive | Immediate end; scout remains recorded alive |
| No active burning cells | Immediate fire-extinguished end |
| Five-minute deadline | No later input applied |
| Multiple ending reasons on one tick | All reasons stored; fixed display precedence |
| Loss versus stranded report | Only actual fire contact causes loss |
| Mission cut off by incident end | No invented successful return |

Use small deterministic graphs for exact navigation tests. Cover travel-time changes after a wind shift, waiting at a constrained junction, return timing after work, mid-edge reversal, and hazard crossing between position samples.

## Reservation and autonomy cases

- Two agents request opposite directions on a constrained segment: one waits at a feasible node; no overlap.
- A withdrawing crew needs a future slot: priority changes only after the other agent verifies yielding.
- Neither can yield normally: do not mark the schedule feasible; initiate independent alternatives/emergency explanations.
- Reversal extends occupancy: downstream reservations change, and affected plans are rechecked.
- New feasible coordinator objective: replaces an ongoing autonomous choice from the actual position.
- New infeasible objective: old feasible plan remains; a reason-coded rejection is emitted.
- Ambiguous instruction: current feasible execution continues during clarification.
- All crews return from partial work: further feasible missions are selected.
- No feasible work now: hold/reassess without falsely resolving sites.

## Communication end-to-end cases

Use deterministic provider fixtures for the full matrix and a small real-provider smoke test before release.

1. Address Crew 2, send a follow-up, receive Scout's report: both outgoing messages still target Crew 2.
2. Explicitly address Crew 1 inside a new voice turn: that message changes the active recipient.
3. Inspect Crew 3 on the map: camera changes, recipient does not.
4. Send no recipient at startup or address two crews: concise clarification before routing.
5. Relay the scout's latest uniquely identified report: source/time preserved and delivered only to the recipient.
6. Request a nonexistent or ambiguous report: no invented facts; clarification explains what is missing.
7. An urgent report interrupts routine playback: queued routine audio stops immediately.
8. An urgent report arrives during capture: transcript/alert appears, recording remains intact, urgent audio has first priority on release.
9. Routine response finishes generating during that capture: it cannot jump ahead of urgent audio.
10. Command application happens before spoken acknowledgement: speech reports the committed result, not a guessed plan.
11. A provider response is delayed while fire changes: apply only after fresh feasibility evaluation.
12. Retry one command ID: exactly one objective revision is applied.
13. Routine report becomes obsolete before playback: skip or summarize current state.
14. Provider fails: existing agents continue; failure is visible; no silent fabricated acceptance.
15. Incident ends during a voice turn: capture stops, unapplied command is rejected, debrief has no stale audio backlog.

Check real microphone permissions, lost key-up/focus, playback cancellation, user transcript accuracy for callsigns/site names, and language-mode customization.

## Frontend and information checks

Inspect both screenshots and network payloads. Visual fog alone cannot prove information isolation.

Test 1440 × 900 and 1024 × 720, high-DPI, keyboard-only use, reduced motion, long transcript, low audio volume, and microphone denied. Verify observed fire, forecast, stale observations, and unknown areas have distinct labels/patterns.

Capture screenshots for briefing, normal work, forecast unreliable, clarification, rejection, withdrawal, retreat/stranded, crew lost, mixed site outcomes, and replay truth mode. Verify no route/status label is hidden by decorative smoke.

Document the actual machine, browser, viewport, package versions, and scenario hash used for performance measurements.

## Performance targets

| Measurement | Target |
|---|---|
| Authoritative step work | p95 under 20 ms; never routinely miss 200 ms scheduling |
| Scoped forecast + replan | p95 under 500 ms for the chosen scenario |
| Client rendering | Aim 60 FPS; minimum 30 FPS on documented release test machine |
| Local urgent text publication | Next server event, without waiting for speech |
| Urgent audio after release | Immediate if buffered; otherwise measure actual provider delay |
| Provider command response | Measure p50/p95; surface pending/failure at documented thresholds |
| Replay determinism | Exact authoritative snapshot hash for a recorded run |

These are acceptance targets, not existing measurements or provider guarantees. Separate network/provider latency from local processing. Do not mask overload by pausing the simulation.

## Fair comparison protocol

Keep the same authored road map, agent capabilities, site work/values, true seed, and initial information. Because protection does not alter spread, all policies can share the same hidden fire trajectory up to their own end.

Evaluate three variants:

- **Current-conditions dispatch:** shortest available route to useful work, with common local hazard detection and emergency response but no complete forecast-based mission admission.
- **Forecast planning without active scouting:** full mission planner and three crews; scout remains at refuge.
- **Ember Line:** same planner plus active ground scout.

The first variant is an evaluation baseline, not an allowed alternative control policy in the released user mode.

Use the same deterministic scripted coordinator policy for comparison runs. It sees only the coordinator projection. Every five simulated seconds it may relay at most one newest unrelayed observation relevant to an agent's last reported route/site, prioritizing withdrawal relevance then stable agent ID. Each delivery uses the same addressed update interface as the human. It does not read truth or invent new facts. Log its policy version and every relay.

This measures navigation/scouting under a stated coordination policy. Human sessions are separate UX evidence, not controlled proof of algorithmic benefit. Do not reuse a human's exact commands as though they were equally appropriate under different evolving states.

Start with 20 held-out seeds after developing on a separate small set. Include earlier-than-prior wind shifts, wider spread rates, no-useful-scout cases, and incidents where conservative planning does little work. Expand only after fixing model errors.

## Outcome reporting and early endings

Report:

- Protection work delivered and site progress, capped per task.
- Final site damage, destroyed sites, and work completed before any later destruction.
- Living/lost crews and scout status separately.
- Completed returns, losses before return, superseded missions, and missions interrupted by incident end.
- Return-plan failures and actual stranded intervals independently of eventual survival.
- Ending reasons and elapsed real/simulated time.
- Refusals, withdrawals, relay counts, and replanning latency.

Show raw returned/started counts, but do not treat an incident-ended mission as a completed return or silently remove its exposure from analysis. If reporting a return fraction among resolved return outcomes, display the interrupted/superseded counts beside it.

Different policies may end at different times when sites resolve. Final health is therefore an endpoint measure under those rules, not an equal-duration fire-exposure experiment. Compare completion time, useful work, losses, and ending reason together. Burned area is scenario context, not a protection-policy improvement claim.

## Two-minute presentation

| Time | Demonstration |
|---|---|
| 0:00–0:20 | Three.js incident desk: crew, sites, two approaches, refuges, incomplete fire picture |
| 0:20–0:40 | Explain a crew's chosen approach/work/return and conditional work window |
| 0:40–1:00 | Scout discovers a change; use push-to-talk to relay its evidence to one crew |
| 1:00–1:25 | Show independent replanning, urgent withdrawal, and automatic safe yielding |
| 1:25–1:45 | Show retained protection, actual crew state, and an ending condition |
| 1:45–2:00 | Replay full fire and present measured comparison outcomes with caveats |

Use recorded/condensed portions of a five-minute-capable run where necessary; do not imply that the two-minute presentation is the entire interaction duration. Rehearse a showcase seed separately from evaluation seeds. The system should still run live, and the presentation must not fabricate its outcomes.

Release evidence still missing for a full product sign-off: Playwright captures on a named machine, real-provider smoke test, production `vite build` on target hardware, and rehearsed demo recording. **Existing evidence:** green CI on typecheck/lint/test, held-out JSON comparison reports, representative failure lists in evaluation output, and session logs with browser verification notes. Describe headline evaluation wins/losses only with the scenario and policy caveats in [SERVER_AND_EVALUATION.md](SERVER_AND_EVALUATION.md).
