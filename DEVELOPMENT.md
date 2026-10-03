# Development setup and running

Quick path for local work on Ember Line. See also [apps/server/README.md](apps/server/README.md) for evaluation harness details.

## Prerequisites

- **Node.js** ≥ 22
- **pnpm** ≥ 10

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

## Mode A — Mock UI (default, no server)

Best for layout, transcript, demo mode, and mock voice. No xAI usage.

```sh
pnpm --filter ember-web dev
```

Open http://127.0.0.1:5173

| URL / env | Effect |
|-----------|--------|
| `?demo=1` | Demo banner and scripted mock traffic |
| `?scenario=…` | Scenario id from the web scenario map (when supported) |

Leave `apps/web/.env.local` unset (or copy from [apps/web/.env.example](apps/web/.env.example) with everything commented).

## Mode B — Live incident server + browser

Runs the real HTTP/WebSocket incident API. Vite proxies `/incidents` and `/health` to port **3000**.

**Terminal 1 — server**

```sh
pnpm --filter ember-server exec tsx src/dev-http.ts
```

**Terminal 2 — web**

Create `apps/web/.env.local`:

```env
VITE_INCIDENT_REST_BASE_URL=
```

(`=` with an empty value uses same-origin paths through the Vite proxy.)

```sh
pnpm --filter ember-web dev
```

Flow: briefing → create incident → WebSocket events → start simulation. Commands go through the server gateway (scripted interpreter unless Mode C intent is enabled).

Check the server:

```sh
curl -s http://127.0.0.1:3000/health | jq
```

Expect `protocolVersion`, `grokVoice`, and `grokIntent` booleans.

## Mode C — Grok Voice and/or Grok intent (optional, uses xAI credits)

Secrets stay on the **server only**. Never commit `XAI_API_KEY` or put it in `VITE_*` vars.

**Server environment** (shell or local env file — see [apps/server/.env.example](apps/server/.env.example)):

| Variable | Required for | Notes |
|----------|----------------|-------|
| `XAI_API_KEY` | TTS, STT, and/or chat intent | Without it, voice and Grok intent are off |
| `XAI_INTENT=1` | Grok command parsing | If unset, live server still uses `ScriptedInterpreter` |
| `XAI_CHAT_MODEL` | Intent only | Default `grok-4-1-fast-non-reasoning` |
| `PORT` | Optional | Default `3000` for `dev-http.ts` |

**Web** (`apps/web/.env.local` with live REST as in Mode B):

```env
VITE_INCIDENT_REST_BASE_URL=
VITE_GROK_VOICE=1
```

With `VITE_GROK_VOICE=1` and a server key:

- Agent/control speech can play via server TTS (`GET …/speech/:itemId`).
- Push-to-talk can use server STT (`POST …/stt`).

With `XAI_INTENT=1` on the server, typed and STT-transcribed commands are interpreted via xAI chat completions (async gateway), not the keyword parser.

**Mic / browser:** allow microphone when prompted; use HTTPS or localhost. If Grok is off, the UI falls back to mock/stub playback where implemented.

## Offline evaluation and navigation calibration

No server or API keys. Scripted coordinator policy only. Read caveats in [docs/SERVER_AND_EVALUATION.md](docs/SERVER_AND_EVALUATION.md) before citing metrics.

| CLI | Purpose |
|-----|---------|
| `evaluate-cli.ts heldout out.json` | 20 held-out seeds × 3 variants (~16 min) |
| `evaluate-cli.ts dev out.json` | 5 development seeds |
| `evaluate-cli.ts showcase out.json` | Rehearsed demo seed |
| `sensitivity-cli.ts out.json` | Forecast prior-width sensitivity (exploratory) |
| `nav-calibration-cli.ts out.json` | Nav + switch-margin presets on dev seeds (`ember_line`) |

```sh
pnpm --filter ember-server exec tsx src/evaluate-cli.ts dev evaluation-results/dev.json
pnpm --filter ember-server exec tsx src/sensitivity-cli.ts evaluation-results/prior-sensitivity.json
pnpm --filter ember-server exec tsx src/nav-calibration-cli.ts evaluation-results/nav-calibration.json
```

Presets: `packages/navigation/src/calibration-grid.ts` ([packages/navigation/README.md](packages/navigation/README.md)). Offline calibration only — not reinforcement learning; do not tune against held-out win rates.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Web stuck on mock / no REST | `VITE_INCIDENT_REST_BASE_URL` set for live mode; server running on 3000 |
| `grokVoice: false` in `/health` | `XAI_API_KEY` exported in the server process |
| Commands behave like keywords only | `XAI_INTENT=1` on server; restart `dev-http.ts` after env changes |
| WS errors | Token on incident create; proxy ws enabled (default Vite config) |
| Clock frozen ~1:40, commands canned | Likely **mock** Vite on `[::1]:5173` while live demo runs on `127.0.0.1`. Use **http://127.0.0.1:5173/** or stop stale listeners: `lsof -iTCP:5173 -sTCP:LISTEN`. Top bar must show **LIVE**, not MOCK. |
| `scripts/demo.sh` refuses to start | Port already in use (IPv4 or IPv6). Kill the listed PID or change `WEB_PORT` / `PORT`. |

## Package entry points

| Package | Dev command |
|---------|-------------|
| Web | `pnpm --filter ember-web dev` |
| HTTP + WS (browser) | `pnpm --filter ember-server exec tsx src/dev-http.ts` |
| Loopback WS harness | `pnpm --filter ember-server dev` (`src/index.ts` — not the Fastify app) |
