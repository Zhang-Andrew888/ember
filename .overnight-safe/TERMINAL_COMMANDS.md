# Copy/paste commands for every laptop

These commands assume macOS, a normal user account, and the repository at `~/ember`. Replace that path if you already cloned elsewhere. If coordinator and Claude worker share a laptop, use two terminals in the same kit directory; their state folders are separate. The detailed safeguards are in START_HERE.md.

No setup script can choose your GitHub/Claude/Cursor account or configure provider spending controls without your participation. Complete browser login and billing verification before sleeping. Model usage tests can cost money; the offline tests below do not.

## 1. All laptops: install common tools

If Homebrew is missing, install it first using its official installer:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the installer's displayed shell setup instructions, then open a fresh terminal. Install tools:

```bash
brew install python git gh node pnpm
brew install --cask tailscale
open -a Tailscale
```

Sign in to Tailscale using the intended private network/device-sharing arrangement. Connect all workers to the coordinator. Restrict private-network access to these devices/port 8765. Keep laptops awake and plugged in.

GitHub authentication on EVERY laptop:

```bash
gh auth login
gh auth setup-git
gh auth status
```

Select GitHub.com and HTTPS when asked. Each account needs repository write/PR access. On a laptop without an Ember checkout:

```bash
git clone https://github.com/Zhang-Andrew888/ember.git "$HOME/ember"
```

If the checkout already exists, do not overwrite it. Save/commit your own work first, then update:

```bash
cd "$HOME/ember"
git status --short
git pull --ff-only
```

Check prerequisites:

```bash
python3 --version
node --version
pnpm --version
git ls-remote https://github.com/Zhang-Andrew888/ember.git HEAD
```

Node must be >=22; pnpm >=10. Worker clones are separate from your personal checkout.

## 2. Laptop A: put the new folder in Git

Download `ember-overnight-safe.zip` and put it in Downloads. Before extracting, make sure no older runner is active. Extract into the repository root:

```bash
unzip -n "$HOME/Downloads/ember-overnight-safe.zip" -d "$HOME/ember"
cd "$HOME/ember"
git add .overnight-safe
git commit -m "Add budget-limited automatic overnight lane and main merging"
git push
```

If `.overnight-safe` already exists, `unzip -n` deliberately will not overwrite it. Stop the old run and extract this release into a NEW run folder or deliberately replace only its source/config files after retaining private state. Do not mix two prepared runs or delete an active budget database.

On workers, fetch the committed folder before continuing:

```bash
cd "$HOME/ember"
git pull --ff-only
```

## 3. Laptop A and Claude worker: install/authenticate Claude

Run on both Claude laptops:

```bash
curl -fsSL https://claude.ai/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
claude --version
claude auth login --console
claude auth status
```

This selects Console/API billing. If you intend subscription billing instead, use `claude auth login` and verify its extra-usage controls rather than assuming API dollars map directly onto included usage. Do not blindly switch accounts if credentials are already configured for a different intended workflow.

Verify provider spending/credit settings in the intended account(s) BEFORE setting billing acknowledgments below. The kit uses $50 internal allocations to leave headroom below your $70-per-role goal, but those limits are not provider invoice guarantees. Existing spend and other account sessions must be considered.

## 4. Laptop C: install/authenticate Cursor

```bash
curl https://cursor.com/install -fsS | bash
export PATH="$HOME/.local/bin:$PATH"
agent --version
unset CURSOR_API_KEY
agent login
```

Authenticate your intended free account. Removing the environment variable prevents unintentionally choosing an explicitly configured CLI API key in this terminal; it does not change the account's billing configuration. Verify no paid on-demand usage/paid fallback is enabled. If you cannot verify that, do not start Cursor tonight.

## 5. Laptop A: inspect protections and pin this checkout

Check the main branch protection/rules in GitHub before expecting a fully unattended main merge:

```bash
gh api repos/Zhang-Andrew888/ember/branches/main/protection
gh api repos/Zhang-Andrew888/ember/rules/branches/main
```

A 404 on the first command may mean there is no classic protection rule or insufficient permissions; it does not prove main is unprotected. Rulesets can impose additional restrictions. The runner never uses admin bypass, force push, or a direct main push. If main still requires human approval, automatic merging cannot finish without that approval. Choose an appropriate repository policy BEFORE leaving; this package does not remove approval/check protections on your behalf.

Pin both tasks to the current checkout and acknowledge coordinator billing ONLY after checking it:

```bash
cd "$HOME/ember/.overnight-safe"
python3 - <<'PY'
import json, pathlib, subprocess
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
p = pathlib.Path('coordinator.json')
c = json.loads(p.read_text())
c['base_commit'] = sha
c['provider_billing_confirmed'] = True
p.write_text(json.dumps(c, indent=2) + '\n')
p = pathlib.Path('tasks.json')
tasks = json.loads(p.read_text())
for task in tasks:
    task['base_commit'] = sha
p.write_text(json.dumps(tasks, indent=2) + '\n')
print('Pinned tasks to', sha)
PY
```

Read the supplied task scopes (sim clock/lifecycle and fixture-driven UI). They are intentionally independent and narrow. Do not call the paid planner tonight.

Find the coordinator's private IPv4 address. The macOS Tailscale app normally exposes its CLI at:

```bash
"/Applications/Tailscale.app/Contents/MacOS/Tailscale" ip -4
```

If that app path differs, copy its IPv4 address from the Tailscale menu/app. Use that actual IP in the next command, not the sample:

```bash
python3 overnight.py prepare --server http://100.101.102.103:8765 --hours 6
source tokens.env
```

Prepare runs only ONCE on Laptop A. It fills worker server URLs, generates role-specific secrets, and starts the six-hour deadline. For an all-on-one-laptop trial, use `http://127.0.0.1:8765` instead. No provider calls occur during prepare.

## 6. Transfer worker configuration privately

Send these two files to each worker's `~/ember/.overnight-safe/` folder:
- Claude laptop: `claude-worker.json`, `claude-token.env`.
- Cursor laptop: `cursor-worker.json`, `cursor-token.env`.

AirDrop/private file transfer works without SSH. Do NOT commit token files. If SSH/Remote Login is already enabled on worker laptops, use these commands from Laptop A, replacing usernames and private IPs:

```bash
scp claude-worker.json claude-token.env CLAUDE_LAPTOP_USER@CLAUDE_LAPTOP_IP:~/ember/.overnight-safe/
scp cursor-worker.json cursor-token.env CURSOR_LAPTOP_USER@CURSOR_LAPTOP_IP:~/ember/.overnight-safe/
```

For scp on macOS, Remote Login must be enabled for the intended user in System Settings > General > Sharing. Restrict access to the intended user/private devices. No SSH server is required if using private file transfer instead.

## 7. Laptop B: confirm its billing and start Claude worker

After receiving the PREPARED config and verifying this laptop's own billing path:

```bash
cd "$HOME/ember/.overnight-safe"
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('claude-worker.json')
c = json.loads(p.read_text())
c['provider_billing_confirmed'] = True
p.write_text(json.dumps(c, indent=2) + '\n')
PY
chmod 600 claude-token.env
source claude-token.env
```

Don't start its runner until the coordinator is listening in step 9.

## 8. Laptop C: confirm free-only billing and prepare Cursor

ONLY after checking that no paid fallback/on-demand usage is enabled:

```bash
cd "$HOME/ember/.overnight-safe"
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('cursor-worker.json')
c = json.loads(p.read_text())
c['provider_billing_confirmed'] = True
c['cursor_provider_limit_confirmed'] = True
p.write_text(json.dumps(c, indent=2) + '\n')
PY
chmod 600 cursor-token.env
source cursor-token.env
```

These booleans record your checks. They do NOT set spending limits.

## 9. Start coordinator, then both workers

Laptop A:

```bash
cd "$HOME/ember/.overnight-safe"
source tokens.env
caffeinate -i python3 overnight.py coordinator
```

Laptop B, in the terminal with its token loaded:

```bash
python3 overnight.py status --config claude-worker.json
caffeinate -i python3 overnight.py worker --config claude-worker.json
```

Laptop C:

```bash
python3 overnight.py status --config cursor-worker.json
caffeinate -i python3 overnight.py worker --config cursor-worker.json
```

Leave terminals and laptop lids open. Watch until both workers connect and dependency setup succeeds. The coordinator handles lane and main PRs/merges after all checks, with no additional paid planning loop. Failure/timeout/protection errors stop the affected task and are recorded.

## 10. Monitor/stop

Another terminal on Laptop A:

```bash
cd "$HOME/ember/.overnight-safe"
source tokens.env
python3 overnight.py status
```

Stop if needed:

```bash
python3 overnight.py stop
```

Morning report:

```bash
python3 -m json.tool coordinator-state/report.json
```

Inspect merged/blocked PRs:

```bash
gh pr list --repo Zhang-Andrew888/ember --state all --limit 20
```

After the runner finishes, update your personal checkout normally:

```bash
cd "$HOME/ember"
git status --short
git pull --ff-only
```

Runtime changes to tracked JSON can prevent a pull if upstream changed the same file. Keep those files/state intact and use a separate clean checkout to inspect main if needed; do not use destructive reset commands on your working copy.

## Linux / Windows WSL

The Python scripts run unchanged. Use your OS package manager to install Python, Git, Node, pnpm, and GitHub CLI instead of brew. Claude/Cursor installers and remaining Git/Python commands work in a POSIX shell. Use `python3 ...` rather than `caffeinate -i python3 ...`, and disable sleep at the host OS level. Tailscale's Linux installation is documented at https://tailscale.com/docs/how-to/quickstart. Do not mix Windows Git authentication with WSL Git authentication without verifying both.
