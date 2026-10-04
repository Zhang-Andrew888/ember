# Issue queue progress

Queue: 110 → 111 → 119 → 120 → 121 → 124. This file lives on `agent/issue-queue-progress`; issue work lives on separate branches. Recheck GitHub before resuming.

| Issue | Status | Branch | PR URL | Root cause | Open questions |
| --- | --- | --- | --- | --- | --- |
| #110 | PR-open | `fix/issue-110-directional-objective` | https://github.com/Zhang-Andrew888/ember/pull/132 | `ObjectiveKind` lacked movement; PR defines eight directions, a 600 m default, 1,200 m cap, and safe road-node stopping. | Merged to `main` by Andrew. |
| #111 | PR-open | `fix/issue-111-directional-crew-movement` | https://github.com/Zhang-Andrew888/ember/pull/135 | Interpreter, gateway, navigation, and controller lacked a directional command path. | Retargeted to `main`, conflicts resolved; await human review. |
| #119 | PR-open | `fix/issue-119-offroad-contract` | https://github.com/Zhang-Andrew888/ember/pull/137 | `AgentPosition` and mission legs represented only nodes and road edges; PR adds bounded off-road positions and half-speed legs. | Await review; #120 owns physical travel. |
| #120 | todo | — | — | Planning and simulation only admit road edges. | Reserved for Andrew's teammate; no branch or code touched in this run. Depends on #119. |
| #121 | todo | — | — | The map supports inspection but no crew destination command flow. | Reserved for Andrew's teammate; no branch or code touched in this run. Depends on #111. |
| #124 | PR-open | `fix/issue-124-camera-compass` | https://github.com/Zhang-Andrew888/ember/pull/128 | The scene had no orientation overlay or camera rotation binding. | Merged to `main` by Andrew. |

## Run notes

- No `fix/issue-*` branches or PRs existed at the start of this run.
- The local `gh` API token failed authentication, but the GitHub connector and Git transport are available.
- `lane/web` exists but trails `main`; issue #124 follows the repository's instruction to target `lane/web`.
- #124 verification: 52 Vitest files and 429 tests passed; ESLint and all package, app, and test type checks passed. GitHub CI Typecheck, Test, and Lint jobs also passed for PR #128.
- Andrew explicitly asked this run to continue all remaining queue issues. Current `main`'s `AGENTS.md` also allows domain contract changes in feature PRs; the earlier blocker is resolved. `lane/sim` does not exist, and Andrew retargeted #124 to `main` before merging it, so new issue PRs target `main` unless the repository state changes.
- Andrew later reserved #120 and #121 for a teammate. This run left both untouched. #119 PR #137 passed 124 Vitest files and 927 tests after rebuilding stale local package output; ESLint, package/app source type checks, and GitHub CI passed.
- #111 PR #135 was retargeted to `main` after #110 merged. The existing branch was updated with current `main` and merge conflicts resolved; the PR is mergeable. Its rerun passed 133 Vitest files and 976 tests, ESLint, package/app type checks, and GitHub CI.
