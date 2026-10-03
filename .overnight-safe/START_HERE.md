# Tonight: start here

See TERMINAL_COMMANDS.md for copy/paste installation and per-laptop commands.

This is a NEW folder, `.overnight-safe/`, for Ember's lane rules. Leave older runners stopped. No runtime state or private credentials are included. Supports Python 3.10+ on macOS/Linux or Windows WSL.

## What you are authorizing when you run it

- One Claude simulation task and one Cursor fixture-driven frontend task, each at most 45 minutes.
- A fresh session with a short task brief. No automatic task expansion or repeated repair loop.
- Independent Claude reviews and at most one bounded conflict repair for each task.
- Pushes to feature/review branches, opens PRs into `lane/sim` and `lane/web`, and automatically merges only after local review/tests and all three GitHub CI jobs pass.
- Automatic promotion PRs into main, with a separate combined-code review and local/GitHub checks. No deployment or paid xAI/Grok calls. Existing protections are never bypassed.
- Cursor failure stops Cursor only. Claude can complete its independent work.

The runtime is pinned to `3d0b0fd4e53229202191ca1ae98024405e739e7c`. If code has advanced beyond this scaffold, update `base_commit` in coordinator.json AND both task objects before prepare. Do not change scope, budgets, or deadline during an active run.

## Conservative spending

| Role | Internal run allocation | Headroom below your $70 target |
|---|---:|---:|
| Claude coding worker | $50 | $20 |
| Claude orchestrator | $50 | $20 |
| Cursor paid allowance | $0 | Uses included/free allowance only |

For the supplied two-task batch, maximum reserved Claude usage is $44: $12 coding + four $2 reviews (lane and main) + up to four $6 conflict repairs (lane and main). The optional planner is NOT needed; calling it adds a $2 reservation. These are conservative reservations, not a prediction or invoice guarantee.

Reservations are made before dispatch, never refunded automatically, and stored in SQLite. Restarting the same run cannot raise its budget or extend its deadline. There is no automatic upgrade, top-up, model fallback, task reassignment, or paid retry. Agents are stopped on timeouts, the global deadline, or coordinator heartbeat loss. Buffer and account limits still matter because local CLI estimates and provider billing may differ.

## Must check BEFORE going to sleep

1. Verify which account/billing path each Claude CLI uses. Prefer a known API-billing path for dollar accounting; do not assume subscription usage equals dollars. Authenticate locally with `claude auth login --console` if using Anthropic Console billing.
2. Set/check provider-level spend controls and remaining credits for the intended accounts/workspaces. Account for spending already incurred and other simultaneous sessions. If both Claude roles share one account, account-level limits are shared: configure them for the combined amount, not $70 total unless that is your intended combined cap.
3. Disable paid on-demand/extra usage and external API fallback for the Cursor free account. The script's $0 reservation DOES NOT configure Cursor billing. If you cannot verify this, leave Cursor off; run the Claude task alone.
4. On Laptop A, after verifying Claude orchestrator billing, set `provider_billing_confirmed` to `true` in `coordinator.json`.
5. On the Claude worker laptop, after its own check, set `provider_billing_confirmed` to `true` in `claude-worker.json`.
6. On Cursor's laptop, after its free-only check, set BOTH `provider_billing_confirmed` and `cursor_provider_limit_confirmed` to `true` in `cursor-worker.json`.

These acknowledgments do not set billing or buy credits. The defaults deliberately refuse to run until you perform the checks. If a provider does not offer the billing control you need, don't leave that paid worker unattended with a strict financial requirement. No script here can promise an exact final invoice.

## Commit this folder

Extract `.overnight-safe/` directly into your Ember checkout. From repository root:

```bash
git add .overnight-safe
git commit -m "Add conservative overnight lane runners"
git push
```

Do this before preparing. Don't commit generated tokens or later runtime config changes. The folder's `.gitignore` protects `.env` secrets and state directories. Never force-add ignored files.

## Common setup on all laptops

Install Python 3.10+, Git, Node >=22, pnpm >=10. Match the repository's pinned packages; don't introduce dependencies tonight.

Each GitHub account must have write access to Ember. Configure authentication:

```bash
gh auth login
gh auth setup-git
```

Coordinator also needs `gh` to create PRs, inspect CI, and merge them. Claude Code must be installed/authenticated on both Claude laptops. Cursor CLI must be installed/authenticated on its laptop. Official install/auth instructions:
- https://code.claude.com/docs/en/cli-reference
- https://cursor.com/docs/cli/headless

Make a private network connection between laptops. Tailscale supports different networks: https://tailscale.com/docs/how-to/quickstart. Share the coordinator device or use the same tailnet with access limited to your worker devices on port 8765. This server uses HTTP inside the private network. Do not expose it publicly.

## Laptop A: coordinator

Clone/pull Ember, then:

```bash
cd ember/.overnight-safe
```

Read both tasks in `tasks.json` and verify the budget/billing settings above. Tasks already name the relevant docs/types; no planner call is needed. Root configuration, lockfile, domain, docs, workflows, and shared fixtures are read-only for workers.

Prepare once, replacing the sample IP with this laptop's actual private/Tailscale IPv4 address:

```bash
python3 overnight.py prepare --server http://100.101.102.103:8765 --hours 6
source tokens.env
```

Prepare creates secrets, fills worker URLs, sets a six-hour absolute deadline, and adds a unique suffix to task IDs to avoid reusing branch names. It won't overwrite an existing prepared run.

Privately send these files:
- Laptop B: prepared `claude-worker.json` and `claude-token.env`.
- Laptop C: prepared `cursor-worker.json` and `cursor-token.env`.

Do not send the admin token or entire `tokens.env` to workers. Copy locally, not through Git. Each laptop's model and Git authentication remains its own.

Start:

```bash
python3 overnight.py coordinator
```

On macOS use:

```bash
caffeinate -i python3 overnight.py coordinator
```

Keep terminal open, charger connected, and lid open. Linux/WSL users must keep the host awake too. If the batch finishes early, the coordinator exits and prevents further work/model calls.

## Laptop B: Claude worker

Clone/pull Ember. Replace `claude-worker.json` with the prepared copy and put its `claude-token.env` beside it. Verify its billing confirmation locally. Do NOT run prepare here.

```bash
cd ember/.overnight-safe
chmod 600 claude-token.env
source claude-token.env
python3 overnight.py status --config claude-worker.json
python3 overnight.py worker --config claude-worker.json
```

macOS:

```bash
caffeinate -i python3 overnight.py worker --config claude-worker.json
```

Claude's edit session has Read/Glob/Grep/Edit/Write tools only. It has no Bash or Agent tool. The Python runner performs dependency installation, checks, commit, and push. This minimizes unexpected paid subprocesses but means a failing first implementation is recorded as blocked rather than entering a repair loop. Never increase its tool set/budget casually while unattended.

## Laptop C: Cursor worker

Clone/pull Ember; copy prepared `cursor-worker.json` and `cursor-token.env`. Verify the free-only acknowledgments above. Do NOT run prepare here.

```bash
cd ember/.overnight-safe
chmod 600 cursor-token.env
source cursor-token.env
python3 overnight.py status --config cursor-worker.json
python3 overnight.py worker --config cursor-worker.json
```

macOS:

```bash
caffeinate -i python3 overnight.py worker --config cursor-worker.json
```

Cursor uses `--force` print mode for unattended edits. Unlike the restricted Claude tool list, that CLI mode can execute tools without confirmation; this runner is not an OS sandbox. Use trusted project code and keep production/provider secrets out of the development environment. Cursor's agent instructions forbid paid APIs, subagents, and Git operations, but prompts are not billing enforcement.

## First supervised check, then sleep

Before sleeping, keep watching until:
- Both workers reach the coordinator successfully.
- Dependency setup completes on each laptop.
- The intended model accounts and provider limits are confirmed.
- No permission/sign-in/runtime errors appear.

Don't repeatedly run paid smoke tests or the planner to troubleshoot. Check local logs first. If one worker cannot run, stop that worker rather than trying unlimited retries. The other can proceed independently.

## Stop/status and morning results

On Laptop A in another terminal:

```bash
cd ember/.overnight-safe
source tokens.env
python3 overnight.py status
python3 overnight.py stop
```

Global stop is sticky; Cursor failure is not global. On coordinator loss, workers cancel after about 60 seconds without a successful heartbeat, plus request/termination time. A disconnected laptop cannot be stopped instantly by a remote server; it also enforces its own deadline/task timeout.

Results are lane PRs followed by main promotion PRs. Your explicit request authorizes the supervisor to perform those merges for this run, overriding the human-only merge instruction in AGENTS.md. GitHub branch protections remain in force; no admin bypass, force push, or direct push into main is used. Each local task must pass `pnpm typecheck`, `pnpm lint`, and `pnpm test` on both the worker and reviewed lane checkout. The scripts wait for actual Typecheck, Lint, and Test checks, reject any reported failed/cancelled check, match the reviewed head SHA, and refuse merging if the base advanced since validation. Missing/pending checks time out without a merge. CI waits do not make model calls.

Files:
- `coordinator-state/report.json`: statuses and conservative reservations.
- `coordinator-state/TASK_ID/publication.json`: draft PR URL, branch, checks.
- `coordinator-state/TASK_ID/review.json`: review verdict.
- `coordinator-state/TASK_ID/conflict-repair.json`: repair details, if attempted.
- `coordinator-state/TASK_ID/integration-error.json`: blocked task reason.
- `claude-state/` and `cursor-state/`: agent/setup/check logs and retained work.

`main_merged` means the task was merged through its lane and promotion PR. `lane_merged_main_blocked` means main promotion failed or GitHub protection prevented it; inspect main-error.json. Main requiring human approval cannot be automatically approved by the PR author. The kit neither removes that protection nor fabricates approval. To require a genuinely unattended main merge, the repository owner must choose a protection policy allowing the runner to merge CI-green PRs before starting. If that policy stays human-only, the run will report a blocked main PR instead. Root/domain/contract changes become reported blockers. No contract-change issue is automatically posted; review the report and follow AGENTS.md's contract process manually.

## Conflict handling

Each task is reviewed in its own checkout based on its target lane's current tip. A real conflict can trigger one Claude edit attempt, capped at $6, 8 minutes, and 15 turns, from the orchestrator's existing $50 allocation. Only conflicted files may be edited. Review/checks must then pass. Failure blocks that task; another task's checkout is unaffected. No branch is force-pushed. Each promotion also rechecks its changes against task ownership; unrelated lane changes block automatic promotion.

## Context and scope

Claude gets one simulation-package task and selected interfaces/specification. Cursor gets only frontend code, the projection schema, frontend specification, and fixture. Workers do not receive previous session transcripts. The orchestrator reviews task briefs and changed files, not the entire project each time. The initial folder includes exactly two independent tasks, so neither worker waits for the other or edits the other's lane.

The scope checks reject commits outside allowed paths. They aren't filesystem access controls: an agent may still read other files if needed. Do not mistake the small read list for an enforced context-window token cap.

## New run / failures

Preserve state when restarting an unstopped crashed coordinator. Financial settings and deadline are fingerprinted; changing them refuses restart. A consumed or interrupted reservation is not refunded. Existing task IDs cannot be relaunched automatically.

If globally stopped or already prepared, use a genuinely new local run folder for the next planned session. Don't delete an active database to reset its budget. New runs need fresh budget decisions; provider-level controls should remain unchanged if you're relying on them as a total spending cap.

## Offline tests

```bash
python3 -m unittest -v test_overnight.py
```

Tests use local Git repositories and simulated CLIs, including fake GitHub PR creation. They do not spend credits or call live model/GitHub APIs. Real auth, model correctness, network sleep behavior, provider billing, and GitHub CI must be verified on your machines. If any safeguard cannot be verified, leave that worker off tonight.
