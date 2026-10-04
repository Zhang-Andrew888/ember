# Issue queue progress

Queue: 110 → 111 → 119 → 120 → 121 → 124. This file lives on `agent/issue-queue-progress`; issue work lives on separate branches. Recheck GitHub before resuming.

| Issue | Status | Branch | PR URL | Root cause | Open questions |
| --- | --- | --- | --- | --- | --- |
| #110 | blocked | — | — | `ObjectiveKind` has no typed directional movement objective. | `AGENTS.md` reserves `packages/domain` contract changes for Andrew, who applies them to `main`. Await that contract. |
| #111 | blocked | — | — | The interpreter and objective pipeline cannot express a directional command. | Depends on #110's approved movement contract. |
| #119 | blocked | — | — | `AgentPosition` and mission legs represent only nodes and road edges. | `AGENTS.md` reserves `packages/domain` contract changes for Andrew. Await that contract. |
| #120 | blocked | — | — | Planning and simulation only admit road edges. | Depends on #119's off-road position and leg contract. |
| #121 | blocked | — | — | The map supports inspection but no crew destination command flow. | Depends on #111's supported command and crew decision. |
| #124 | diagnosing | `fix/issue-124-camera-compass` | — | The scene has no orientation overlay or camera rotation binding. | Verify world north as negative scene `z` and test orbit/reset. |

## Run notes

- No `fix/issue-*` branches or PRs existed at the start of this run.
- The local `gh` API token failed authentication, but the GitHub connector and Git transport are available.
- `lane/web` exists but trails `main`; issue #124 follows the repository's instruction to target `lane/web`.
