# Agents

This file is the single source of truth for multi-agent work on this repo.
CLAUDE.md and .cursor/rules/agents.mdc both point here - read this file first.

## Lane ownership

Two agent lanes run in parallel against their own branch.
**Only the human (Andrew) merges lane branches into main.**

| Lane | Branch | Owns |
|------|--------|------|
| sim | `lane/sim` | `packages/simulation`, `packages/knowledge`, `packages/forecast`, `packages/navigation`, `packages/agents`, `packages/communication`, `packages/replay`, `apps/server` |
| web | `lane/web` | `apps/web` |

The `packages/domain` package is **shared read-only** infrastructure.
Neither lane may edit it - see "Contract changes" below.

## Forbidden paths

| Lane | May NOT touch |
|------|---------------|
| sim | `apps/web/**` |
| web | `packages/simulation/**`, `packages/knowledge/**`, `packages/forecast/**`, `packages/navigation/**`, `packages/agents/**`, `packages/communication/**`, `packages/replay/**`, `apps/server/**` |
| both | `packages/domain/**` (read-only; changes require a contract-change issue) |
| both | `CHANGELOG.md`, `docs/**` (documentation is human-authored) |
| both | `.github/workflows/**` (CI is human-authored) |

## Contract changes

`packages/domain` contains the Zod schemas and TypeScript interfaces that both lanes compile against.
If your implementation reveals that a schema is wrong or missing:

1. **Do not edit `packages/domain` directly.**
2. Open a GitHub issue titled "Contract change: <description>" and label it `contract`.
3. Describe the needed change and why the current schema is insufficient.
4. Andrew reviews and applies the change to `main`; both lanes rebase.

This protects both lanes from racing on the same domain file and breaking each other's builds overnight.

## Commit rhythm

- Commit working, CI-green increments; do not commit broken code to a lane branch.
- Keep commits focused: one logical change per commit, short present-tense subject line.
- PR title format: `[lane/sim]` or `[lane/web]` prefix, e.g. `[lane/sim] add fire spread tick`.
- Open PRs into the lane branch (not main). Merge to lane branch when CI is green.
- Andrew merges lanes into main after reviewing the combined diff.

## PR and review flow

```
feature work -> open PR -> lane/sim or lane/web -> merge when CI green
                                                          |
                                               Andrew reviews and merges to main
```

- Agents may self-merge PRs into their own lane branch when all three CI checks pass.
- Agents must never force-push to lane branches or main.
- Agents must never push directly to main.

## Branch protection summary

main requires:
- Passing CI (typecheck, lint, test)
- At least one human approval (Andrew)
- No direct pushes

lane/sim and lane/web require:
- Passing CI
- No force-push

(Configure these rules in GitHub Settings > Branches after the first push.)

## Stack constraints

- TypeScript strict mode, exactOptionalPropertyTypes, noUncheckedIndexedAccess - no suppression without a comment.
- Zod for all cross-boundary validation; never cast `unknown` without parsing.
- No new direct dependencies without a comment explaining why the workspace devDependency is insufficient.
- Do not introduce a database, message broker, or serverless function (see ARCHITECTURE.md).
- Simulation tick must complete in < 200 ms wall time; flag benchmark regressions.

## What good increments look like

Each merged increment should:
- Pass all three CI checks (typecheck, lint, test).
- Add or update Vitest tests for new behavior.
- Leave the fixture in `tests/fixtures/coordinator-view.fixture.ts` valid (web lane depends on it).
- Not expose private world state through any API or WebSocket message.

## Cursor Cloud specific instructions

- Node 22 or newer and pnpm 10 are enough. No provider secrets: the live stack uses the no-provider adapters.
- After checkout, run `pnpm install --frozen-lockfile` and `pnpm build:libs`. Package entry points resolve to `dist`, so the server cannot start until libraries are built. CI checks are `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
- The HTTP API is `startHttpApp` on `127.0.0.1:3000` (`GET /health`). `pnpm --filter ember-server dev` does not listen. Vite runs at `http://127.0.0.1:5173` and proxies `/incidents` and `/health` to port 3000. Set `VITE_INCIDENT_REST_BASE_URL` to an empty string so the UI creates a real incident through that proxy. A non-empty value is also a base URL; leaving the variable unset uses the mock incident.
