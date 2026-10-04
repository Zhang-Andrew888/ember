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

`packages/domain` is shared infrastructure. Either lane may update its schemas and interfaces
when needed for work in that lane; include the contract change in the same feature PR.

## Forbidden paths

| Lane | May NOT touch |
|------|---------------|
| sim | `apps/web/**` |
| web | `packages/simulation/**`, `packages/knowledge/**`, `packages/forecast/**`, `packages/navigation/**`, `packages/agents/**`, `packages/communication/**`, `packages/replay/**`, `apps/server/**` |
| both | `CHANGELOG.md`, `docs/**` (documentation is human-authored) |
| both | `.github/workflows/**` (CI is human-authored) |

## Shared contract changes

`packages/domain` contains the Zod schemas and TypeScript interfaces that both lanes compile against.
When a feature needs a contract change:

1. Update `packages/domain` in the feature branch, with tests for the changed contract.
2. Update the owning lane's implementation and fixtures in that PR. If the other lane has a
   consumer to update, coordinate a separate PR in that lane.
3. Run typecheck, lint, and tests across the workspace before merging into the lane branch.
4. If both lanes change the same contract, coordinate the change and rebase the later PR on
   the merged version instead of overwriting either lane's work.

Agents may implement contract changes without a separate issue or Andrew applying the schema
change to `main`. The existing review and merge rules for lane branches and `main` still apply.

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
- Keep private world parameters and future fire truth out of APIs and WebSocket messages.
  Current fire may be shown to the authorized coordinator when a feature explicitly requires it;
  crew projections and planning inputs must still contain only crew-available knowledge.
