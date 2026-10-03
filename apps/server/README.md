# apps/server

Server-side composition of the sim lane. No provider keys are needed: everything runs against the
no-provider test adapter (`ScriptedInterpreter`, `RecordingSink`).

## Pieces

| File | What it does |
|---|---|
| `runner.ts` | `IncidentRunner`: advances an incident to the simulated time due on a monotonic clock |
| `session.ts` | `IncidentSession`: incident + one controller per agent + reservation service |
| `conversation.ts` | `ConversationBridge`: gateway, audio scheduler and transcript over a session |
| `hub.ts`, `protocol.ts` | `SessionHub` (validated client messages, sanitized server messages) and `LiveRun` |
| `http-app.ts`, `incident-registry.ts` | `startHttpApp`: `POST /incidents`, auth token, `POST …/start`, replay export, WS `/events` and `/voice` |
| `ws-server.ts` | `startServer`: loopback WebSocket server driving the hub every 200 ms (dev harness) |
| `policy.ts` | `ScriptedCoordinatorPolicy`: the deterministic relay-only coordinator used in comparisons |
| `evaluation.ts` | `runVariant` / `runEvaluation`: dispatch baseline vs forecast planning vs Ember Line |
| `evaluate-cli.ts`, `sensitivity-cli.ts` | offline runners that write JSON reports |

## HTTP + WebSocket transport (protocol v1)

`startHttpApp` is the browser-facing entry point:

1. `POST /incidents` — creates an incident, returns `{ incidentId, token, websocket: { events, voice } }`.
2. Open the events URL (token in query or `x-incident-token` header on upgrade).
3. `POST /incidents/:id/start` with header `x-incident-token` — starts the simulation clock.
4. All WebSocket frames are `{ protocolVersion: 1, message: … }` (see `protocol.ts`).

Voice uses the same JSON push-to-talk client messages as events.

### Grok Voice (optional)

Set **`XAI_API_KEY`** on the server. Outgoing lines are synthesized via xAI TTS (`GET /incidents/:id/speech/:itemId`); incoming PTT can use xAI STT (`POST /incidents/:id/stt` with JSON `{ audioBase64, mimeType }`).

For **Grok intent** (chat completions instead of `ScriptedInterpreter`), also set **`XAI_INTENT=1`**. Optional **`XAI_CHAT_MODEL`** (default `grok-4-1-fast-non-reasoning`). `GET /health` reports `grokVoice` and `grokIntent`.

```sh
export XAI_API_KEY=...
export XAI_INTENT=1   # optional; without it, commands use ScriptedInterpreter
pnpm --filter ember-server exec tsx src/dev-http.ts
```

Web: `VITE_INCIDENT_REST_BASE_URL=` and `VITE_GROK_VOICE=1` in `apps/web/.env.local`, then `pnpm --filter ember-web dev`.

## Commands

```sh
pnpm --filter ember-server exec tsx src/evaluate-cli.ts heldout out.json   # 20 held-out seeds x 3 variants
pnpm --filter ember-server exec tsx src/evaluate-cli.ts dev out.json       # 5 development seeds
pnpm --filter ember-server exec tsx src/evaluate-cli.ts showcase out.json  # rehearsal seed only — not for variant comparison
pnpm --filter ember-server exec tsx src/sensitivity-cli.ts out.json        # exploratory prior-width study
pnpm --filter ember-server exec tsx src/nav-calibration-cli.ts out.json   # nav + switch-margin dev-seed sweep (not RL)
```

A full held-out run takes about 16 minutes on four cores. Recorded results live in `evaluation-results/`; read the
caveats in each report and `OVERNIGHT_LOG.md` before quoting a number. For the demo pitch table, run
`scripts/demo.sh --comparison` from the repo root (held-out aggregates only).

## Rules this package enforces

- The simulator alone advances the world; `LiveRun` only moves it to `dueSimTimeMs(wall)` and reports backlog.
- Nothing sent to a client contains the seed, private world parameters or truth fire state (tested on every message
  of a run and on a real socket).
- Client input is schema-validated before it reaches the incident.
