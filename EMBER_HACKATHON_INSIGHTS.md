# Ember Line — hackathon review and preparation notebook

## Review control

- Started: 2026-10-04 04:36 UTC. Requested local cutoff: 01:10; finish by 01:30. Timezone/date clarification pending. Do not assume an elapsed deadline authorizes a new day's deadline.
- Repository: `/workspace/ember`; inspected HEAD `7ee2436b42f4d6dbc18ea7a5fc31e8c4183bec39`.
- Scope: review, probes, and this notebook only. No source edits, commits, pushes, PRs, or external publication.
- This notebook is outside the repository to respect `AGENTS.md`'s human-authored `docs/**` rule.
- Evidence labels: **code** = inspected implementation; **artifact** = checked-in result, not rerun; **verified** = executed during this review; **proposal** = preparation idea; **open** = unverified.

## Read first — final review handoff

1. Lead with **navigation of a whole mission, including work and escape**, and voice as a radio interaction with accountable crew decisions.
2. Verify sponsor eligibility: current implementation uses separate **xAI STT/TTS** requests and optional Grok chat, not an established realtime Voice Agent session.
3. Demo current implementation: **three crews, no active scout, coordinator sees current fire**; crew-local information remains separate.
4. Use explicit callsigns and transcript/crew decisions. Confirmed gaps: PTT release waits for STT before urgent playback; recipient context can change during STT; async receipts are absent; map command IDs do not match live receipt IDs; Grok prompt omits containment.
5. Fresh 20-seed synthetic result: **4 dispatch crew losses versus 0 forecast crew losses**, **667.05 versus 600 mean work**, same **1 mean standing protected site**. Show both safety and productivity; no field guarantee or causal Grok claim.
6. All 1,058 collected tests have passing results across rebuilt baseline and targeted permission reruns; server/web typechecks, lint and production web build passed. Genuine provider/browser/audio proof remains open.
7. Recorded default `showcase-1` offline schedule below gives three accepted crew objective changes and an exact replay hash match. It produces no withdrawal/refusal/yield; do not promise those events.

## Current thesis

**Ember Line is a wildfire navigation simulation where a human coordinator uses radio-style conversation to guide autonomous crews that evaluate an approach, useful work, and a return to refuge against uncertain fire forecasts.**

Suggested tagline: **Navigate into a changing wildfire—and keep a way out.**

Navigation relevance: the shortest route into a site is insufficient when the way back can burn while the crew works. Mission planning includes departure times, work duration, road occupancy, forecast hazards, and escape. Navigation includes deciding when to stop working and when to decline an objective.

Sponsor relevance: xAI speech recognition turns push-to-talk into commands; optional Grok chat interpretation converts language to validated intents; xAI speech synthesis speaks committed crew reports. The incident continues while providers work. Voice is integrated with recipient selection, command lifecycle, and prioritized urgent radio traffic.

**Do not describe this as a deployed emergency dispatch tool or validated wildfire model.** This is a simulation and interaction prototype. No field performance or safety guarantee is established.

## Critical corrections to old documentation

The README and product/specification docs are useful history but materially stale relative to current code. Prepare slides from implementation evidence.

| Topic | Older documents | Current code evidence | Presentation consequence |
| --- | --- | --- | --- |
| Grok | Integration remains future work | `apps/server/src/xai/{stt,tts,chat}.ts`, browser capture/playback and server routes exist | Say implemented; live-provider validation remains open |
| HTTP | REST/Fastify not wired | `http-app.ts` implements create/start/STT/speech/replay and event sockets | Show actual server, not mock transport |
| Scout | Three crews plus active scout | Default `scenario.ts` has three protection crews; `session.ts` gives legacy scouts no controller | Do not promise autonomous scouting in current demo |
| Coordinator fire visibility | Incomplete fire only, truth revealed after run | `Incident.projectCoordinator` publishes current burning/burned cell indices to coordinator | Distinguish current coordinator fire from crew-local information and hidden future parameters |
| Protection affects spread | Protection does not change spread | Cell containment work now reduces spread; site protection remains separate | Do not reuse old spread-invariant comparison rationale without checking variants |
| Map input | No map commands | `MapCommandPanel.tsx` drafts a directional movement utterance and sends it | Voice-first presentation can coexist with map-assisted movement |
| Travel | No off-road travel | Off-road plans, movement, certification and tests exist | Explain actual supported paths only after following active route |
| Real geography | OSM still pending | Packaged Montclair OSM data and scenario generator exist | Default HTTP incident still uses synthetic graph; packaged data is not proof the live run uses it |

Important: the broader picture belongs to the coordinator. The crew and forecast input boundary must still exclude coordinator-only current fire, private seed, fire timers and future truth. See `apps/server/src/xai/knowledge-boundary.test.ts`, `packages/agents/src/isolation.test.ts`, and current-fire contract tests.

## Architecture and Grok integration evidence

```text
Microphone / MediaRecorder
  → browser POST /incidents/:id/stt (incident token)
  → server multipart POST https://api.x.ai/v1/stt
  → transcribed text through the command gateway
  → optional Grok /v1/chat/completions → Zod IntentEnvelope
  → recipient + evidence resolution → deterministic crew controller
  → timed mission search / forecast certification / reservations
  → authoritative simulation → decision + text report
  → server POST https://api.x.ai/v1/tts → stored MP3
  → prioritized audio cue → browser playback → acknowledgement
```

- **Code:** STT and TTS are file/unary HTTP calls, not a persistent realtime speech-to-speech session. `/voice` WebSocket accepts JSON PTT messages. Do not call it a realtime Grok Voice Agent integration without evidence.
- **Code:** default TTS voice `eve`, language `en`; optional interpreter model `grok-4-1-fast-non-reasoning`.
- **Code:** `XAI_API_KEY` enables voice; `XAI_INTENT=1` plus key enables Grok interpretation. Web requires live transport and `VITE_GROK_VOICE=1` for the relevant path.
- **Code:** `/health` reports configuration flags, not a successful provider request. A green badge is not live-provider proof.
- **Code:** API key stays server-side. Browser uses an incident token, including query token for WebSocket URLs.
- **Code:** model JSON is schema-validated and command IDs/sequences are assigned by the gateway. Invalid output produces clarification.
- **Code:** crew mission planning and safety certification are deterministic; Grok interprets coordinator language only. Report phrasing is generated locally before TTS, rather than unconstrained model-authored acceptance.
- **Code:** interpretation deadline is 10 seconds; STT/TTS reuse it. End-to-end STT + chat + TTS latency can exceed one 10-second stage. Measure stages separately.
- **Finding:** Grok system prompt's objective list omits `contain`, while `IntentEnvelope` and scripted interpreter support it. Avoid showcasing voice containment before a live test confirms behavior; log as preparation risk rather than editing source.

### Sponsor-track eligibility question

**Open:** exact sponsor wording and eligible API products have not been supplied. If the award specifically requires the Grok realtime Voice Agent API, standalone xAI STT/TTS plus chat may not meet that requirement. Obtain the official track text and judge rubric. Until then, describe endpoint use precisely.

### The strongest sponsor demo

1. Speak an addressed command in natural language, showing an actual transcript.
2. Show interpretation and committed acceptance/rejection with an observable route/status change.
3. Hear the crew report through actual xAI TTS.
4. Use a follow-up without repeating the name and show the retained recipient.
5. Explain that urgent reports are scheduled independently of provider latency and action does not wait for speech.

Do not spend the sponsor demo entirely showing a map or canned mock speech. A refusal is a successful command lifecycle if the reason and preserved state are visible.

## Demo runbook — proposed 2-minute primary cut

| Time | Visible beat | Spoken explanation | Evidence to rehearse |
| --- | --- | --- | --- |
| 0:00–0:15 | Incident map, crews, sites, refuges | “A route in is only useful if the crew still has a way out after working.” | LIVE transport and correct scenario |
| 0:15–0:35 | One admitted mission, work/return timing | “We evaluate the whole mission against retained plausible fire futures.” | Current route, work interval, refuge |
| 0:35–1:00 | Live PTT command and spoken crew response | “Grok turns radio traffic into an addressed, validated objective.” | Real STT, optional chat, real TTS; no mock banner |
| 1:00–1:20 | Follow-up status or rehearsed infeasible objective | “The crew checks current conditions before accepting. A refusal explains the limiting condition.” | Command exact wording and deterministic seed |
| 1:20–1:40 | Work progress and autonomous state | “The fire keeps moving while we talk. Crew action never waits for audio.” | Avoid promising a withdrawal that does not occur |
| 1:40–2:00 | Outcome/replay or recorded condensed ending | “We record decisions and consequences so the run can be examined afterward.” | Label condensed/recorded material and current-fire versus future truth |

Optional 3-minute cut: add targeted evidence relay and interruption behavior only after demonstrating they occur on the chosen build. A five-minute-capable incident is longer than the presentation; use an explicitly labeled cut rather than pretending a full incident takes two minutes.

### Rehearsal command candidates

- “Crew 2, protect Ridge Cabins.” Acceptance is scenario/time dependent; do not promise it.
- “Crew 2, status.” Then “Return to refuge.” Confirm active recipient retention.
- “Crew 1, move northeast 200 meters.” Actual feasibility still applies.
- “Crew 1 and Crew 2, protect Waterworks.” Expected clarification, not silent multi-agent dispatch.
- “The eastern road is clear.” Unsupported safety assertion must not manufacture evidence.
- Choose an infeasible objective from a recorded run; rejection is not guaranteed by a site name alone.

### Fallback ladder

1. Live voice fails: state which stage failed; use typed input to show real simulation. Typed input still depends on chat when Grok interpretation is enabled; it is not a guaranteed fix for a complete provider outage.
2. Provider outage: use an explicitly labeled recorded clip of the genuine earlier provider run; demonstrate offline deterministic simulation separately.
3. Server failure: use labeled mock/recorded playback for UI walkthrough, never sponsor integration proof.
4. GPU/projector trouble: lower rendering quality and show transcript/status clearly; keep screen recording locally.

## Proposed slide deck (6 slides + appendix)

1. **Problem — the road back changes while you work.** One approachable wildfire navigation vignette; no invented emergency statistics.
2. **Experience — a voice-operated incident desk.** Large screenshot with crew, refuge, work window and command transcript. Explain current coordinator visibility and separate crew knowledge.
3. **Navigation — certify a mission, not just a path.** Approach → work → return; plausible futures and road reservations; conditional feasibility rather than guarantees.
4. **Grok — radio in, accountable action out.** Actual endpoint pipeline with transcript, validated intent, committed decision, TTS. Clarify deterministic planning boundary.
5. **Evidence and limits.** Current test/probe results. Historical evaluation only if labeled with commit/scenario/policy and no implied current-build result.
6. **What comes next.** Validate speech latency/accuracy in noisy settings, scenario coverage, specialist feedback, and scalable forecast execution. State prototype status.

Appendix: exact API products, per-agent knowledge diagram, replay determinism, performance hardware, comparison caveats, privacy/retention, failure matrix.

## Written submission draft — source-grounded, pending final proof

**Title:** Ember Line — navigate into a changing wildfire and keep a way out.

**Inspiration:** Navigation becomes harder when the environment changes during the task. In a wildfire scenario, choosing the shortest route to a structure is not enough: a crew must arrive, do useful work, and preserve a route to refuge. We wanted the coordinator to express intent naturally while crews retain responsibility for checking what they can execute.

**What it does:** Ember Line is a five-minute wildfire coordination simulation with a Three.js incident desk and autonomous protection crews. The coordinator communicates through text or push-to-talk. Crews evaluate objectives against their available observations, plausible fire forecasts, and road reservations. The simulation records decisions, work, losses, and incident endings for review.

**How we built it:** A TypeScript monorepo separates domain contracts, the authoritative simulation, per-agent knowledge, forecasting, navigation, agents, communication, replay, and the server/web applications. xAI STT transcribes recorded microphone turns, optional Grok chat interpretation produces schema-validated command intents, and xAI TTS speaks crew reports. Deterministic controllers perform mission planning and feasibility checks; model-generated language cannot directly authorize a route.

**Challenges:** Keeping the incident running while interpretation and speech are asynchronous; keeping coordinator information separate from crew knowledge; evaluating the full work-and-return timeline; and making refusal, uncertainty, and provider failure visible. Current code and historical documentation have diverged, so the submission must follow the reviewed build.

**Accomplishments:** Integrated voice request/report paths; timed mission planning; independent crew knowledge; deterministic replay mechanisms; authenticated local HTTP/WebSocket transport; and a Three.js visual interface. Replace this paragraph's implementation claims with executed evidence where available before submission.

**What we learned:** A natural interface needs an explicit authority boundary. A well-formed utterance can still request an infeasible mission; an understandable refusal is part of a useful interaction. Conservative planning also imposes a productivity cost that must be reported honestly.

**Next:** Live speech evaluation, representative scenario testing, accessible interaction studies, forecast execution/performance work, and feedback from domain experts. No claim of operational readiness.

## Historical evaluation — useful but not current-build proof

**Artifact:** `apps/server/evaluation-results/heldout-20-seeds.json`: synthetic-v1, scenario hash `9c5ecd7133a15661350556bd6ec5096f`, scripted-relay policy v2, 20 seeds.

| Historical mean | Dispatch | Forecast/no scout | Ember Line |
| --- | ---: | ---: | ---: |
| Protection work | 802.5 | 600 | 600 |
| Protected and standing sites | 1.45 | 1.00 | 1.00 |
| Destroyed sites | 1.2 | 1.3 | 1.3 |
| Total crews lost over 20 runs | 11 | 0 | 0 |

Interpretation: safety/productivity tradeoff in one synthetic setting; no measured scouting improvement in this artifact. Zero observed losses does not mean guaranteed survival. Current code removes the default scout and adds containment affecting spread, so old variants and outcomes must not be presented as a current-build controlled experiment without a fresh, appropriate protocol.

## Judge Q&A — technical

| Likely question | Answer direction / proof needed |
| --- | --- |
| What exactly uses Grok? | STT for PTT, optional chat for intent, TTS for reports. Name actual endpoints and show live proof. |
| Is this the realtime Voice Agent API? | Inspected path uses unary STT/TTS plus chat; realtime agent session is not established. Check sponsor eligibility wording. |
| Why not let Grok plan routes? | Language expresses intent; deterministic planner evaluates whole missions from allowed knowledge. This makes behavior inspectable and replayable. |
| Can hallucinations cause unsafe acceptance? | Zod parsing, grounded evidence resolution, and controller checks constrain action. Schema validity alone is insufficient; semantic errors still require tests. |
| Can I tell a crew an unsafe road is clear? | Unsupported assertions do not create observations or remove hazards. Show test or rehearsed command. |
| Is safety guaranteed? | No. Feasibility is relative to the model, retained futures, information and margins; model mismatch can cause loss. |
| Why not A* alone? | A static shortest route omits work duration, time-dependent hazards, escape and occupancy. Use timed mission search. |
| How do crews share knowledge? | Local knowledge plus targeted coordinator relay; global coordinator view is not automatically crew input. Default current run has no active scout. |
| Does the coordinator see truth? | Current fire cell indices are intentionally visible to coordinator; private parameters, timers and future truth remain excluded. Crew input remains scoped. |
| What happens when forecasts contradict observations? | Reliability becomes unreliable; broaden/rebuild; empty/unreliable ensemble does not admit protection. Check runtime blocking cost. |
| What if a road is occupied? | Reservation feasibility and verified yielding; priority cannot force an infeasible wait. |
| Does speech delay action? | Decisions/actions publish before synthesis/playback; text remains available. STT/chat delay still affects when a new command is available. |
| What if the browser disconnects? | Server clock continues; reconnect receives current state. Audio queue/disconnect tests exist. |
| Are retries duplicated? | Command IDs/sequence and gateway duplicate handling aim for one application; show cross-layer tests. |
| Is replay deterministic if Grok is nondeterministic? | Replay records applied decisions/inputs; it should not rerun provider interpretation as though identical. Verify exact snapshot comparison. |
| Is the map real? | OSM-derived scenario assets exist, but default HTTP run uses authored synthetic map. Describe demo mode explicitly. |
| Does containment change fire spread? | Current cell containment does; site protection and damage are separate. Old comparison assumptions need revision. |
| Can it scale to real geography/many crews? | Not demonstrated. Report scenario sizes, forecast costs, and measured machine; avoid extrapolation. |
| What does it cost? | Measure actual utterance audio duration, text usage, report frequency and current provider pricing; no invented per-incident number. |
| What are its security boundaries? | Server-only API key, random incident token, loopback hosting, origin/host checks. Production auth/rate limiting requires further review. |
| What tests prove the voice integration? | Unit tests mock fetch; they prove request formatting/failure logic, not provider availability, microphone accuracy or audible playback. |

## Judge Q&A — product and nontechnical

| Likely question | Answer direction |
| --- | --- |
| Who is this for? | Demonstrated: hackathon simulation participants. Hypothesis: training/research exploration for coordination interfaces; validate with practitioners. |
| Why voice over buttons? | Express goals while watching the map and retain a radio-style interaction; usability advantage needs study. Text provides an alternative. |
| Why wildfire? | A clear setting for navigation under changing hazards, work windows, uncertainty and limited egress. |
| Is this a game or emergency tool? | A simulation prototype. Training suitability and operational use are future hypotheses. |
| What makes it different from a map with chatbot? | Conversation resolves to crew-specific intents; decisions are evaluated by mission navigation and appear as actions and outcomes. |
| Why Grok specifically? | Actual xAI input/output speech paths with optional natural-language interpretation. Do not assert superiority without comparison. |
| What is the human's role? | Set objectives, inspect reports, relay grounded evidence; crew routing and feasibility remain autonomous. |
| Can humans override refusal? | Modeled survival checks remain with the controller; clarify limits and rejected revision. |
| Did it save more structures? | Historical forecast result saves fewer sites than dispatch while losing fewer crews; no current-build superiority claim. |
| What's the biggest weakness? | Live provider evidence and representative evaluation remain essential; simplified physics and conservative planning limit conclusions. |
| What was built during the hackathon? | Verify initial commit/time boundary and reused assets before answering; do not invent provenance. |
| What's the business model? | Not validated. A training/research tool is a possible direction; obtain buyer/user feedback before making market claims. |
| Is it accessible? | DOM controls, text, keyboard/reduced-motion work exist; verify actual projector readability and assistive use. Voice-only is not required. |
| What about sensitive audio? | Microphone recordings go through local server to xAI. Explain provider handling separately; local retention behavior needs inspection. |
| What would you do with another week? | Provider smoke/latency measurements, repeatable sponsor demo, scenario/version reconciliation, and focused user testing. |

## Corner cases to investigate and rehearsal matrix

### Voice and interpretation

- Callsign confusion (Crew 2 / crew two), noisy hall, accent, quiet voice, site-name transcription.
- Unsupported mime types, short/empty audio, very long PTT and HTTP body limit, browser codec differences.
- Mic denied; permission prompt outlives release; focus loss; key release missed; mobile touch cancellation.
- Multiple/no recipient; recipient changes while STT is pending; concurrent inputs return out of order.
- STT success + chat failure; chat success + TTS failure; provider 401/429/5xx; 10-second abort.
- Invalid but schema-shaped intent; wrong site/callsign; prompt injection; unsupported evidence claim.
- Urgent line arrives during capture; buffered versus not-yet-ready TTS; stale routine acknowledgement; browser autoplay refusal.
- End of incident while recording, awaiting transcript, interpreting, synthesizing or playing.

### Simulation and navigation

- Safe arrival but unsafe return; useful partial work; work at already destroyed/complete site.
- Reservation wait consumes escape margin; opposing crews; mid-edge reversal; actual position versus junction teleport.
- Empty/contradicted forecast; broader recovery still fails; horizon shorter than complete mission.
- Crew survives but incident ends away from refuge; stranded versus physically lost; simultaneous end reasons.
- Different crew-local observations; current coordinator fire accidentally entering a crew/LLM prompt.
- Off-road traversal intersects a hazard between sampled endpoints; off-road occupancy versus road reservations.
- Containment changes spread while forecast model assumes unsuppressed dynamics; conservative versus inconsistent model fit.
- Default scout removed but legacy records/components still mention it; dead recipient in directory.

### Demo and submission

- Live versus mock confusion; localhost IPv6 stale process; unrelated service on health port; pre-created incident starts on WebSocket upgrade.
- Seed reproducibility; rehearse version/scenario/command timing together, not seed alone.
- No withdrawal occurs despite old script promising it; rejection still produces a compelling evidence beat.
- Historical comparison mismatch to current scout/containment behavior; cherry-picked showcase presented as aggregate evaluation.
- Five-minute run truncated to two minutes without labeling; claimed full replay includes only client views.
- Venue network, projector font size, muted audio, HTTPS mic requirements, token in shared recordings/logs.

## Review log and next probes

- 04:36–04:38 UTC: found repository, read instructions/specification, traced xAI endpoint code and mission certification. Found major specification drift (scout removal, coordinator current fire, containment, map movement, REST integration).
- `pnpm test` failed before tests because installed pnpm 11 attempted dependency management under an unwritable home path. Repository pins pnpm 10.32.1. No dependency files changed; direct local Vitest invocation started instead.
- Next: complete current checks; inspect practical voice failure paths, current default incident behavior, evaluation provenance, and write prioritized demo blockers. No provider key is configured in the managed runtime, so no live xAI proof yet.

## Confirmed preparation risks — second pass

### P1: physical PTT release does not immediately release urgent audio

**Verified with delayed STT fixture, real hub/gateway:** after browser `stop()` resolves but before transcription returns, the server scheduler remains `isRecording=true`; a prepared urgent line stays queued. `ConversationPanel.commitCapture` invokes `onPttRelease` only after `settleGrokCapture` finishes transcription. `SessionHub.noteCaptureEnded` runs only when the release/cancel frame arrives.

Implication: do not claim urgent audio plays immediately on physical button release. It resumes after STT succeeds or fails. The urgent text can still be published immediately. Rehearsal should use short turns and measure this extra delay. A future design could separate capture-ended acknowledgement from transcript submission, preserving single application; no fix made during this review.

### P1: captured recipient is not honored when recipient changes during STT

**Verified:** addressed Crew 1; began PTT; delayed STT; submitted a typed Crew 2 status request; then released unaddressed transcript `hold position`. Receipt targeted **Crew 2**. `PushToTalk` stores `capturedRecipientId`, but `SessionHub` submits only `utterance.text` to the gateway, which uses the active recipient at that later time.

Implication: always say an explicit callsign in the sponsor demo and wait for the completed receipt before switching. Do not promise begin-of-recording recipient pinning across asynchronous transcription. Probe artifact: `/tmp/ember-voice-probes.json`; standalone probe: `/tmp/ember-voice-probes.mts`.

### P1: Grok prompt does not advertise containment

**Code + probe:** the strict JSON objective description in `buildIntentSystemPrompt` lists protect/observe/return/hold/avoid/resume/move, omitting contain. The schema and scripted parser include contain. A model may still infer it, but consistent live voice containment is unproven. Prefer protection/status/return or directional commands for the sponsor demo.

### P1: asynchronous interpretation does not emit a final receipt frame

**Verified with injected delayed interpreter:** immediate response had no receipt; after delivering and applying a valid hold intent, `hub.afterStep` produced a view and two transcript frames, but no receipt. `SessionHub.handle` sends receipts from `bridge.say`'s immediate return. Async Grok completion invokes `bridge.applyOutcomes`; `hub.afterStep` broadcasts transcript, decisions, audio and notices but has no general asynchronous receipt drain. Command application and text acknowledgement occur; the expected receipt lifecycle is incomplete. Probe: `/tmp/ember-async-probes.json`.

### P1: map command status cannot correlate live receipts

**Verified:** browser `dispatchSay` uses its UUID as idempotency key and map row command ID. `ConversationBridge.say` regenerates a server `cmd-N` ID. `applyReceipts` requires exact command ID equality. Even injecting a valid accepted server receipt left the browser map row at `sent`. This affects synchronous interpretation too. Use visible transcript/crew decisions as evidence; do not promise live map-panel status settles correctly.

### Evaluation and runtime findings

- **Verified:** rebuild of all eight library packages succeeded using local `tsc` in dependency order. Builds refresh ignored `dist` files; no tracked source changes.
- **Verified:** three fresh demo seeds `review-001..003`, through 450 simulated seconds, had no withdrawal or yield. This is a tiny rehearsal search, not outcome evidence. CLI `sighting=0s` includes initial briefing observations, so that field is not necessarily a new crew sighting.
- **Code:** current evaluation has **two variants** (`dispatch`, `ember_line`), not three. Legacy scout factory returns null. Old stored artifact is from commit `0b56ac32bb1e980a26136275e899e5e1cfbc0712`, measured `2026-10-03T21:14:49.722Z`.
- **Code:** forecast refresh/rebuild runs synchronously in controller ticks. A simulated `rebuildLatencyMs` delay is not a worker boundary. Do not claim live forecasting runs in separate workers; replay reveal does have a worker.
- **Code:** `SpeechAudioStore` retains prepared bytes for the incident; registry removes ended incidents after 30 minutes, and live pumping has a 60-second end grace. Provider-side retention is not established by this local code.
- Fresh held-out evaluation started against reviewed HEAD, output `/workspace/EMBER_REVIEW_HELDOUT_CURRENT.json`. Treat its current embedded “all variants share one hidden fire trajectory / protection does not alter spread” caveat cautiously: cell containment now alters spread. Test actual variant containment behavior before comparing outcomes.

## Fresh executed evidence — 2026-10-04

### Current held-out result

**Verified:** full 20-seed evaluation, two current variants, reviewed HEAD `7ee2436b42f4d6dbc18ea7a5fc31e8c4183bec39`; report timestamp `2026-10-04T04:43:51.385Z`; scenario hash `481d04702407c9ff67fb3f13375f605d`; policy scripted-relay v2. Raw report: `/workspace/EMBER_REVIEW_HELDOUT_CURRENT.json`. CLI reported 76 seconds runtime on this environment; simultaneous verification jobs make timing unsuitable as an isolated benchmark.

| Metric | Dispatch | Ember Line |
| --- | ---: | ---: |
| Runs | 20 | 20 |
| Mean work delivered | 667.05 | 600 |
| Mean protected and standing sites | 1 | 1 |
| Mean destroyed sites | 1.3 | 1.3 |
| Total crews lost | 4 | 0 |
| Mean simulated duration | 1363.95 s | 1363.95 s |
| Time-expired / all-sites-resolved endings | 10 / 10 | 10 / 10 |
| Replan p95 | 21 ms | 3 ms |
| Simulation step p95 | 1 ms | 1 ms |
| Simulation step max | 41 ms | 31 ms |

Loss examples: dispatch lost two crews on `heldout-05` and two on `heldout-11`; Ember Line lost none in the batch. These replace the historical 11-versus-zero comparison **for this reviewed build only**. Work was about 10.1% lower in Ember Line; both averaged one protected standing site. Say: “In this 20-seed synthetic benchmark, forecast planning had fewer observed crew losses at a cost in work.” Do not say “guaranteed safety,” “more structures saved,” or “Grok improved survival”; provider language is not exercised by this evaluation.

The checked-in `scripts/demo.sh --comparison` still reads the older report. Do not use its output as though it displayed these new numbers. Keep a standalone slide/table backed by the fresh JSON instead; no source/report files inside the repository were changed.

### Verification status

- **Verified:** eight workspace libraries built successfully in dependency order with installed TypeScript.
- **Verified:** server and web typechecks passed; lint passed with no output.
- **Verified:** production Vite build passed, 205 modules. Main emitted JS about 3.96 MB uncompressed / 531 KB gzip; large-chunk warning. Build output is `/tmp/ember-review-web-build`; actual GPU/FPS and browser microphone performance still unmeasured here.
- **Verified:** rebuilt suite: 1,041 / 1,058 tests passed under default sandbox; 17 failed on denied local socket/child-process execution, not reported assertion failures in application logic. Avoid calling the entire suite green until restricted cases are rerun.
- **Verified:** HTTP/WebSocket/origin subset passed 18 / 18 with local network permission. Remaining script/incident-hardening cases are being rerun separately.
- **Verified, final rerun:** incident hardening and demo script/comparison tests passed 11 / 11 with required execution permission. Together these reruns cover all 17 restricted failures in the original rebuilt suite (plus overlapping cases). All 1,058 collected test cases now have a passing result across the baseline and targeted reruns. This was not one single unrestricted whole-suite run.
- Original pre-rebuild failure counts were caused largely by stale `dist` exports; do not list those as current source defects.

### Next demonstration proof still missing

- An actual provider turn: recorded mic audio → successful xAI STT → optional Grok intent → real crew decision → audible xAI TTS.
- No credential or ready provider binding in this managed runtime; `api.x.ai` is outside its startup destination allowlist. Do not paste credentials into the notebook. Perform provider proof on the configured demo machine.
- Venue/browser/device timing and screenshot evidence; sponsor's exact API eligibility; current demo seed/command schedule.

## Preparation priority and decisions

| Priority | Concrete task | Why it matters | Current status |
| --- | --- | --- | --- |
| Before sponsor submission | Confirm official eligible Grok Voice API product and rubric | Unary STT/TTS is not proof of realtime Voice Agent use | Awaiting hackathon/track wording |
| Before rehearsal lock | One genuine mic-to-command-to-spoken-report recording on demo machine | Distinguishes configured adapters from demonstrated integration | Cannot execute with this runtime's configured credentials |
| Before slides lock | Use current three-crew behavior and coordinator current-fire visibility | Avoids contradicting what judges see | Current behavior documented here |
| Before demo lock | Explicit callsigns; short PTT; wait for command acknowledgement | Avoids verified recipient race and reduces STT-induced urgent-audio delay | Workaround ready; source unchanged |
| Before demo lock | Show transcript and crew decisions for accepted/refused commands | Async receipts/map status have verified gaps | Workaround ready; source unchanged |
| Before statistics slide | Use new JSON, exact scenario/hash/policy, both work and losses | Old comparison script serves historical data | Fresh two-variant report saved outside repo |
| Before showing interruption | Rehearse an actually occurring urgent event | Three searched seeds showed no withdrawal/yield | Do not promise unrehearsed drama |
| Before public demo | Check viewport/audio/projector, localhost transport, provider readiness | Unit tests cannot prove these | Still requires demo-machine check |

### Proposed 30-second pitch

“Ember Line explores navigation when the road back can change while you work. You coordinate autonomous crews through radio-style voice commands, while each crew evaluates an approach, work window and return against its own information and plausible fire forecasts. xAI transcribes the command and speaks the crew's report; optional Grok interpretation turns natural language into a validated objective. The crew can accept or explain why it cannot comply. It is a simulation prototype, and every action leaves a record we can examine afterward.”

### Proposed sponsor-specific closing

“The speech integration is connected to the mission lifecycle: an addressed request becomes a validated intent, the crew evaluates it, and the committed result becomes spoken radio traffic. Our next validation is measuring recognition and response latency on the demo hardware and verifying the exact eligible Voice API requirement.”

After genuine provider rehearsal, replace the last sentence with the actual measured proof. Do not state that exact eligibility is confirmed if it remains open.

### Claims to use and avoid

| Defensible wording | Wording unsupported by this review |
| --- | --- |
| “Complete timed missions, including a modeled way back” | “The AI guarantees crew survival” |
| “xAI STT/TTS adapters with optional Grok intent” | “Realtime Grok Voice Agent session” |
| “Separate crew knowledge; coordinator can see current fire” | “Nobody can see live current fire” |
| “Three autonomous protection crews in the default run” | “Three crews and an autonomous scout in today's demo” |
| “Fewer observed losses, lower work in this synthetic benchmark” | “Grok saved more lives/structures” |
| “Current-fire display and future/private information boundary” | “A translucent fog proves no truth reaches the browser” |
| “Replay from recorded applied inputs; checked hash” | “We rerun the LLM and get the same answers” |
| “Packaged OSM scenario capability; default live graph is synthetic” | “This default run uses real Oakland roads” |
| “Tests and production build passed; live speech still needs proof” | “Production-ready emergency response platform” |

### Submission packaging checklist

- Project name/tagline and one clear navigation problem statement.
- Demo URL or exact local run instructions; explicitly identify mock/recorded/live mode.
- Repository and reviewed commit; user decides publication/sharing (nothing pushed here).
- Short demo video with one genuine provider turn, legible transcript and audible reply.
- Current architecture diagram and precise sponsor endpoints, including optional chat flag.
- Technology list: TypeScript, React/Vite, Three.js/React Three Fiber, Node/Fastify/WebSocket, Zod, Vitest, xAI STT/TTS and optional Grok chat.
- Team contribution/hackathon build window and reused assets verified by human participants; do not infer them from current code alone.
- OSM attribution when geography is shown; local font licenses already packaged, other asset provenance should be checked for actual exported media.
- Evaluation source/version and candid limitations; no old scout-benefit claim.
- Future work grounded in measured gaps, with no unsupported market size or operational endorsement.

## Completed default-seed rehearsal and replay

**Verified offline, current default scenario, `showcase-1`, scripted interpreter:** the following requests were accepted by the gateway, and the three objectives also produced `objective_accepted` crew decisions. These are nominal real-time offsets derived from 5× simulation speed; actual live STT/chat latency changes application timing, so rehearse genuine voice separately.

| Nominal real offset | Simulated time | Utterance | Observed result |
| --- | --- | --- | --- |
| 0 s | 0 s | Crew 2, status | Holding at refuge |
| 20 s | 100 s | Crew 2, protect Ridge Cabins | Objective accepted; plan changes |
| 40 s | 200 s | Crew 2, status | Approaching Ridge Cabins; return estimate 725 incident seconds |
| 60 s | 300 s | Crew 2, protect Community Lodge | Objective accepted; plan changes |
| 80 s | 400 s | Crew 2, return to refuge | Objective accepted; plan changes |

Ran through 1,500 simulated seconds; end reason `time_expired`. Replaying recorded applied inputs produced **`hashMatches: true`**; final snapshot hash `d6bc175d1a8fd566235dc25d6d0f5280`. JSON saved at `/workspace/EMBER_REVIEW_DEMO_REHEARSAL.json`.

This run produced mission start/update and idle decisions, **no refusal, withdrawal, or yielding**. The status at 200 seconds included an older `Last report: Crew 2 is heading to Community Lodge` alongside the current Ridge Cabins objective. Treat “last report” as history, not authoritative current assignment.

**Code caveat for spoken replies:** `ConversationBridge.apply` adds control acknowledgements/status replies to the transcript but does not itself enqueue them for xAI TTS. `collect` synthesizes crew decision reports, losses and ending speech. For the sponsor demo, use an objective that produces a crew decision for the audible output beat; do not promise every status/control reply is spoken.

### Final work boundary

- Final consolidation: 2026-10-04 approximately 05:18 UTC. Deadline timezone/date was requested early but not supplied in the session; this notebook does not claim compliance with an unconfirmed local 01:10/01:30 window.
- No tracked repository changes observed at final `git status --short`; only ignored build products were refreshed and review artifacts written outside the repository.
- No source changes, commits or pushes. No xAI provider requests, messages to others or external publication.
- Final artifacts: this notebook; current held-out JSON; offline demo/replay JSON. Temporary detailed test/probe/build evidence is under `/tmp/ember-review-*`, `/tmp/ember-voice-probes*`, `/tmp/ember-async-probes*`, and `/tmp/ember-demo-rehearsal*`.
