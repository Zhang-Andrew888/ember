# Issue queue progress

Queue: 110 → 111 → 119 → 120 → 121 → 124. This file lives on `agent/issue-queue-progress`; issue work lives on separate branches. Recheck GitHub before resuming.

| Issue | Status | Branch | PR URL | Root cause | Open questions |
| --- | --- | --- | --- | --- | --- |
| #110 | PR-open | `fix/issue-110-directional-objective` | https://github.com/Zhang-Andrew888/ember/pull/132 | `ObjectiveKind` lacked movement; PR defines eight directions, a 600 m default, 1,200 m cap, and safe road-node stopping. | Await review and CI. |
| #111 | PR-open | `fix/issue-111-directional-crew-movement` | https://github.com/Zhang-Andrew888/ember/pull/135 | Interpreter, gateway, navigation, and controller lacked a directional command path. | Stacked on #110; retarget to `main` after #132 merges. |
| #119 | diagnosing | `fix/issue-119-offroad-contract` | — | `AgentPosition` and mission legs represent only nodes and road edges. | Design bounded coordinates and 50% off-road speed. |
| #120 | todo | — | — | Planning and simulation only admit road edges. | Depends on #119's position and leg contract. |
| #121 | todo | — | — | The map supports inspection but no crew destination command flow. | Depends on #111's supported command and crew decision. |
| #124 | PR-open | `fix/issue-124-camera-compass` | https://github.com/Zhang-Andrew888/ember/pull/128 | The scene had no orientation overlay or camera rotation binding. | PR #128 has been merged to `main`. |

## Run notes

- No `fix/issue-*` branches or PRs existed at the start of this run.
- The local `gh` API token failed authentication, but the GitHub connector and Git transport are available.
- `lane/web` exists but trails `main`; issue #124 follows the repository's instruction to target `lane/web`.
- #124 verification: 52 Vitest files and 429 tests passed; ESLint and all package, app, and test type checks passed. GitHub CI Typecheck, Test, and Lint jobs also passed for PR #128.
- Andrew explicitly asked this run to continue all remaining queue issues. Current `main`'s `AGENTS.md` also allows domain contract changes in feature PRs; the earlier blocker is resolved. `lane/sim` does not exist, and Andrew retargeted #124 to `main` before merging it, so new issue PRs target `main` unless the repository state changes.
