# Demo readiness report

Testing of `main` (commit `45fe69e`) on 2026-10-03, in preparation for the demo. Covers: baseline CI, a
headless end-to-end smoke test, a ~50 minute manual browser session in live mode (real server behind the
Vite proxy), and targeted WebSocket probes of the conversation layer.

## How to launch and test

```sh
scripts/demo.sh              # live mode: server :3000 + web :5173 wired together (Ctrl-C stops both)
scripts/demo.sh mock         # web only, in-browser mock socket
scripts/demo.sh --smoke      # start everything, run scripts/smoke.mjs (30 checks), exit non-zero on failure
scripts/demo.sh --no-web     # server only
```

`scripts/smoke.mjs` needs only Node >= 22 built-ins. It covers: health, incident creation, token auth
negatives, REST start, replay-while-active 409, events socket, inspect, malformed frames, idempotent `say`,
clock advance at 1 sim-second per 200 ms wall, monotonic sequence, protocol-v1 envelopes, a private-field
leak scan on every frame, a second client joining mid-run, and the Vite proxy (HTTP and WebSocket).

## What was fixed in this pass

| Fix | Where | Why it mattered |
|---|---|---|
| Added a process entry point (`apps/server/src/main.ts`); `pnpm dev` / `pnpm start` now launch the HTTP+WS app | `apps/server` | `index.ts` is a barrel of exports. `pnpm --filter ember-server dev` started nothing, so the web proxy to `:3000` had nothing to talk to. **Live mode was not launchable from the repo as merged.** |
| Active-recipient desync after a clarification | `packages/communication/src/gateway.ts` | "Crew 2, hold" / "Crew 1 stop" (not understood) / "Crew 1, protect Waterworks" left the UI saying *Addressing: Crew 2* while Crew 1 was being commanded. The gateway moved its own recipient but dropped the `set_recipient` action when it asked for clarification. Regression test added. |
| Launcher + smoke test | `scripts/` | Repeatable demo start and a pre-demo gate. |

Baseline CI on `main` was green (typecheck, lint, 622 tests) and remains green with these changes.

## What works well (observed)

- 3D scene renders terrain, roads, sites, refuges, crews and observed fire; agents move along roads and
  change state (idle, approaching, working, withdrawing). Camera orbit/zoom/reset work.
- Urgent strip fires on withdrawals ("Crew 2 is withdrawing. The forecast no longer certifies the road ahead
  with the required margin.").
- Incident runs to completion in 5 real minutes (incident clock to ~20:00 at 5x), end overlay freezes the
  page (`inert`), reload and *Start again* return cleanly to the briefing.
- Server pacing holds at ~4.9 sim-seconds per wall-second; no private fields in any frame; auth negatives
  behave; malformed frames are rejected without dropping the socket.
- Commands that work reliably with the scripted interpreter: `Crew 1, protect Ridge Cabins`,
  `Crew 1, go to Ridge Cabins`, `Crew 2, hold position`, `Crew 3, withdraw to Refuge South`,
  `Scout, status report`, `Status report, over.` (follow-ups without a name go to the active recipient).

## Issues to address before it is presentable

Severity: **blocker** = will visibly fail in a demo; **major** = noticeably wrong or confusing; **minor** = polish.

### Blocker

1. **The coordinator's own commands and the server's replies never appear in the transcript.**
   The web client (`apps/web/src/net/CoordinatorViewClient.ts`, `wireProtocol.ts`) only parses `view`
   frames and drops `transcript`, `receipt`, `decision`, `notice`, `audio`, `ended` and `inspection`.
   The right-hand panel shows only `view.recentReports` (agent reports). Consequences during the demo:
   - You type `Everyone pull back`; the server answers *"I could not tell what you want done. Which action
     should I send?"* — the UI shows nothing, while the local speech stub says **"Received: Everyone pull
     back"**, which is false.
   - Clarification questions, rejections, and status answers (`Scout, status report` returns a useful
     paragraph) are all invisible.
   Fix: handle `transcript` (kinds `coordinator`, `control`, `agent`) and `receipt` in the client and render
   them in the conversation panel; replace the "Received: …" stub text with the real receipt reply.

2. **Replay after a live run shows a canned 5-event mock log, not the run that just happened.**
   `ReplayView` reads `net/replayLog.ts` (built from the fixture, which has only Crew 1, Crew 2 and Scout,
   so **Crew 3 is missing**). The server's `GET /incidents/:id/replay` returns a single final view, so
   there is nothing to replay even if the client asked. In the test environment the replay scene also went
   fully black with `THREE.WebGLRenderer: Context Lost` (software WebGL; verify on demo hardware).
   Recommendation: hide the *Replay* button in live mode for the demo, or record views client-side during
   the run and replay those.

### Major

3. **End overlay has no outcome.** It says *"All sites were resolved (protected or destroyed)"* and the
   incident time, but not which sites survived, work delivered, or crews lost — the only numbers the
   audience wants at the end.
4. **Raw internal identifiers in user-facing text.** Agent reports and status replies say
   *"Scout is scouting n-s"*, *"returning to n-rw"*, *"work site (n-s)"*; map labels show
   `work_interval_limited_by_forecast`; the transcript lists `crew-1` instead of *Crew 1*. Use callsigns
   and place names (refuge/scout-point names exist in the scenario).
5. **Site labels claim staleness for things never observed:** *"Waterworks — unprotected (stale, seen 4:58
   ago)"* at incident time 4:58 means it was never observed (`lastObservedAt: 0`). Should read
   *"not yet observed"*.
6. **Label clutter.** A dozen *"fire may reach 12:10–30:30 (incident time)"* forecast labels plus route
   labels overlap each other and the site labels at the default zoom (see screenshots). Consider showing
   forecast labels only on hover/selection or collapsing them.
7. **Map framing.** The terrain occupies roughly the upper 60% of the canvas with a large empty black band
   below at the default camera; *Reset camera* should frame the whole map.
8. **All three crews pick Community Lodge at t=0** and Ridge Cabins / Waterworks stay unprotected unless
   the coordinator intervenes (also documented in `docs/SERVER_AND_EVALUATION.md`). Acceptable as the
   "coordinator must act" hook, but the presenter should know it and open with a redirect command.
9. **Status replies are hard to read:** *"Return estimate: 253 incident seconds"* — format as m:ss incident
   time, consistent with the rest of the UI.

### Minor

10. Push-to-talk is a mock that emits one of three canned transcripts; the third one,
    *"Relay the scout's latest observation."*, is answered with a clarification (*"I have no received report
    matching Scout"*) early in the run. Either reorder/replace the canned lines or hide PTT for the demo.
11. The top bar shows `0:33` and `4:53 remaining` with no labels; first-time viewers do not know which is
    incident time and which is real time.
12. `Scene debug (dev only)` button and the Legend/Observed-cells dev panel are visible in `vite` dev mode
    and the debug button draws above the end overlay. Run `vite build && vite preview` for the demo, or
    hide them.
13. Missing `favicon.ico` (404 in console) and React DevTools banner — cosmetic; use a production build.
14. Vite proxy targets `http://localhost:3000` while the server binds `127.0.0.1`. Worked here, but on a
    machine where `localhost` resolves to `::1` first the proxy will fail; safer to target `127.0.0.1`.
15. Finished incidents are kept forever in the in-memory `IncidentRegistry`; *Start again* creates a new
    one each time. Fine for a demo, worth a note.

## Recommended demo path (until the above are fixed)

1. `scripts/demo.sh --smoke` as the pre-flight gate, then `scripts/demo.sh`.
2. Open http://localhost:5173, Start.
3. Within the first 30 s send `Crew 1, protect Ridge Cabins` and `Crew 2, protect Waterworks` (watch the
   agent rail and routes change; the *Addressing* label follows).
4. Use `Scout, status report` and `Crew 3, withdraw to Refuge South` later; avoid free-form phrasing.
5. Let it run to the end overlay; skip *Replay*.

## Artifacts

Screenshots from the browser session are attached to the pull request that introduced this file.
