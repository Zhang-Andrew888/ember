# Agents

This file is the single source of truth for multi-agent work on this repo.
CLAUDE.md and .cursor/rules/agents.mdc both point here - read this file first.

## Lane ownership

Two agent lanes run in parallel. A lane describes which part of the repo an agent
mainly works in; it is not a separate branch to merge into.
**Agents open PRs against `main` and merge to `main` directly.**

| Lane | Owns |
|------|------|
| sim | `packages/simulation`, `packages/knowledge`, `packages/forecast`, `packages/navigation`, `packages/agents`, `packages/communication`, `packages/replay`, `apps/server` |
| web | `apps/web` |

The `lane/sim` and `lane/web` branches are no longer merge targets. Do not open PRs
into them.

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
4. Andrew reviews and applies the change to `main`; both lanes merge `main` into their working branches.

This protects both lanes from racing on the same domain file and breaking each other's builds overnight.

## Commit rhythm

- Commit working, CI-green increments; do not commit broken code to a branch that will be merged.
- Keep commits focused: one logical change per commit, short present-tense subject line.
- PR title: a short description of the change. A `[lane/sim]` or `[lane/web]` prefix is optional.
- Open PRs into `main`. Merge to `main` when CI is green.

## PR and review flow

```
feature work -> open PR -> main -> merge when CI is green
```

- Agents may self-merge PRs into `main` when typecheck, lint and test all pass.
- A PR that clearly departs from the product plan (`docs/IMPLEMENTATION_PLAN.md` and the spec documents) is rejected with a written reason instead of merged.
- Agents must never force-push to `main`.
- Agents must never push directly to `main`; always go through a PR.

## Branch protection summary

main requires:
- Passing CI (typecheck, lint, test)
- No direct pushes
- No force-push

(Configure these rules in GitHub Settings > Branches. Remove any human-approval requirement on `main` if agents are to self-merge.)

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
