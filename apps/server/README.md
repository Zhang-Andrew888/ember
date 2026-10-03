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
| `ws-server.ts` | `startServer`: loopback WebSocket server driving the hub every 200 ms |
| `policy.ts` | `ScriptedCoordinatorPolicy`: the deterministic relay-only coordinator used in comparisons |
| `evaluation.ts` | `runVariant` / `runEvaluation`: dispatch baseline vs forecast planning vs Ember Line |
| `evaluate-cli.ts`, `sensitivity-cli.ts` | offline runners that write JSON reports |

## Commands

```sh
pnpm --filter ember-server exec tsx src/evaluate-cli.ts heldout out.json   # 20 held-out seeds x 3 variants
pnpm --filter ember-server exec tsx src/evaluate-cli.ts dev out.json       # 5 development seeds
pnpm --filter ember-server exec tsx src/evaluate-cli.ts showcase out.json  # the rehearsed seed
pnpm --filter ember-server exec tsx src/sensitivity-cli.ts out.json        # exploratory prior-width study
```

A full held-out run takes about 16 minutes on four cores. Recorded results live in `evaluation-results/`; read the
caveats in each report and `OVERNIGHT_LOG.md` before quoting a number.

## Rules this package enforces

- The simulator alone advances the world; `LiveRun` only moves it to `dueSimTimeMs(wall)` and reports backlog.
- Nothing sent to a client contains the seed, private world parameters or truth fire state (tested on every message
  of a run and on a real socket).
- Client input is schema-validated before it reaches the incident.
