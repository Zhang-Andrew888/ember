# Claude Code - Ember Line

Read AGENTS.md before starting any work.
It defines lane ownership, forbidden paths, commit rules, and shared-contract changes.

## Quick reference

- **Your lane branch:** check which branch you are on (`git branch --show-current`).
- **Shared contracts:** either lane may update `packages/domain` for its feature; follow AGENTS.md.
- **Forbidden:** pushing to main or the other lane's branch.
- **Required:** all three CI checks pass before merging to your lane branch.

## Project overview

Ember Line is a five-minute wildfire coordination simulation.
See README.md for the full document index.
The implementation slices are in docs/IMPLEMENTATION_PLAN.md.

## TypeScript rules

- Strict mode is on. No `@ts-ignore` or `as any` without a comment.
- All cross-boundary data must be validated with the Zod schemas from `@ember/domain`.
- Use `import type` for type-only imports (`@typescript-eslint/consistent-type-imports` is enforced).

## Simulation rules

- The simulation worker alone mutates world state.
- `simTimeMs` (integer) and `wallElapsedMs` (integer) are always distinguished - never compare them raw.
- Private world parameters must never reach the coordinator projection or any WebSocket message during an active run.

## Testing

- Run `pnpm test` from the repo root to run all Vitest tests.
- Run `pnpm typecheck` to check types across all packages.
- Run `pnpm lint` to check ESLint rules.
- Add tests for new behavior; do not ship logic with zero test coverage.
