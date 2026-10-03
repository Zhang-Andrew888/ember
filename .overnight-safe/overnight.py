#!/usr/bin/env python3
"""Two remote coding workers and a Claude planner/reviewer. Python 3.10+, stdlib only."""
import argparse, contextlib, datetime as dt, hashlib, http.server, json, os
import pathlib, re, secrets, signal, sqlite3, subprocess, threading, time, urllib.error, urllib.request, urllib.parse, ipaddress

ROOT = pathlib.Path(__file__).resolve().parent

def read(path):
    return json.loads(pathlib.Path(path).read_text())

def write(path, value):
    pathlib.Path(path).write_text(json.dumps(value, indent=2) + '\n')

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def epoch(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()

def run(args, cwd=None, timeout=120):
    return subprocess.check_output(args, cwd=cwd, text=True, stderr=subprocess.STDOUT, timeout=timeout).strip()

def stop_process(p):
    if p.poll() is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        os.killpg(p.pid, signal.SIGTERM)
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(p.pid, signal.SIGKILL)
        p.wait()

def execute(args, cwd, output, timeout, cancel=lambda: False):
    """POSIX process group: stop the CLI and children on timeout/interrupt."""
    env = os.environ.copy()
    for key in list(env):
        if key.startswith('OVERNIGHT_'):
            env.pop(key)
    with open(output, 'w') as log:
        p = subprocess.Popen(args, cwd=cwd, stdin=subprocess.DEVNULL, stdout=log,
                             stderr=subprocess.STDOUT, env=env, start_new_session=True)
        started = time.monotonic()
        try:
            while p.poll() is None:
                if time.monotonic() - started >= timeout or cancel():
                    stop_process(p)
                    return 124
                time.sleep(1)
            return p.returncode
        finally:
            stop_process(p)

class Store:
    def __init__(self, path, config):
        self.path, self.config = str(path), config
        with self.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,
                result TEXT, heartbeat REAL);
                CREATE TABLE IF NOT EXISTS allocations (
                key TEXT PRIMARY KEY, owner TEXT NOT NULL, cents INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS control (key TEXT PRIMARY KEY, value TEXT);
                INSERT OR IGNORE INTO control VALUES ('stopped','0');''')
            fingerprint = hashlib.sha256(json.dumps({key:config.get(key) for key in ('usable_budget_cents','allocations_cents','plan_budget_cents','review_budget_cents','conflict_repair_budget_cents','deadline')},sort_keys=True).encode()).hexdigest()
            prior = db.execute("SELECT value FROM control WHERE key='run_fingerprint'").fetchone()
            if prior and prior[0] != fingerprint:
                raise RuntimeError('Budget/deadline changed for an existing run; refusing restart')
            db.execute("INSERT OR IGNORE INTO control VALUES ('run_fingerprint',?)",(fingerprint,))
    def db(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        return db
    def stopped(self, db):
        return db.execute("SELECT value FROM control WHERE key='stopped'").fetchone()[0] == '1' or time.time() >= epoch(self.config['deadline'])
    def reserve(self, db, key, owner, cents):
        if db.execute('SELECT 1 FROM allocations WHERE key=?', (key,)).fetchone():
            return False
        total = db.execute('SELECT COALESCE(SUM(cents),0) FROM allocations').fetchone()[0]
        own = db.execute('SELECT COALESCE(SUM(cents),0) FROM allocations WHERE owner=?', (owner,)).fetchone()[0]
        if cents < 0 or (cents == 0 and owner != 'cursor') or total + cents > self.config['usable_budget_cents'] or own + cents > self.config['allocations_cents'][owner]:
            return False
        db.execute('INSERT INTO allocations VALUES (?,?,?)', (key, owner, cents))
        return True
    def add(self, tasks):
        if self.config.get('lane_mode') and len(tasks) > self.config.get('max_tasks',2):
            raise ValueError('Fixed batch exceeds conservative task limit')
        # This is an operator-approved task list, not arbitrary worker input.
        with self.db() as db:
            for task in tasks:
                validate_task(task)
                if self.config.get('enforce_lane_scope'):
                    validate_lane_task(task,self.config)
                db.execute('INSERT OR IGNORE INTO tasks VALUES (?,?,?,NULL,NULL)',
                           (task['id'], json.dumps(task), 'ready'))
    def pause_worker(self, db, worker, reason):
        db.execute('INSERT OR REPLACE INTO control VALUES (?,?)', ('paused:' + worker, reason))
        for row in db.execute("SELECT id,payload FROM tasks WHERE status='ready'").fetchall():
            if json.loads(row['payload'])['worker'] == worker:
                db.execute("UPDATE tasks SET status='worker_unavailable',result=? WHERE id=?",
                           (json.dumps({'ok':False,'error':reason}),row['id']))

    def refresh_failures(self, db):
        # Worker loss never trips the global stop switch. No automatic re-dispatch.
        cutoff = time.time() - self.config.get('worker_stale_seconds', 180)
        for row in db.execute("SELECT * FROM tasks WHERE status='running' AND heartbeat<?", (cutoff,)).fetchall():
            task = json.loads(row['payload'])
            reason = 'Worker heartbeat expired; local work may be incomplete'
            db.execute("UPDATE tasks SET status='blocked',result=? WHERE id=?",
                       (json.dumps({'ok':False,'error':reason}),row['id']))
            if task['worker'] == 'cursor' and self.config.get('pause_cursor_on_failure', True):
                self.pause_worker(db, 'cursor', reason)
        failed = {'blocked','budget_blocked','integration_blocked','review_budget_blocked',
                  'dependency_blocked','worker_unavailable'}
        while True:
            changed = False
            for row in db.execute("SELECT id,payload FROM tasks WHERE status='ready'").fetchall():
                deps = json.loads(row['payload']).get('depends_on', [])
                bad = [dep for dep in deps if (r := db.execute('SELECT status FROM tasks WHERE id=?',(dep,)).fetchone()) and r[0] in failed]
                if bad:
                    db.execute("UPDATE tasks SET status='dependency_blocked',result=? WHERE id=?",
                               (json.dumps({'ok':False,'error':'Unavailable dependencies: '+', '.join(bad)}),row['id']))
                    changed = True
            if not changed:
                break

    def claim(self, worker):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self.refresh_failures(db)
            if self.stopped(db):
                return {'stop': True}
            paused = db.execute('SELECT value FROM control WHERE key=?', ('paused:' + worker,)).fetchone()
            if paused:
                return {'stop': True, 'worker_only': True, 'reason': paused[0]}
            for row in db.execute("SELECT * FROM tasks WHERE status='ready' ORDER BY rowid").fetchall():
                task = json.loads(row['payload'])
                if task['worker'] != worker:
                    continue
                deps = task.get('depends_on', [])
                if any(not (r := db.execute('SELECT status FROM tasks WHERE id=?',(dep,)).fetchone()) or r[0] != 'integrated' for dep in deps):
                    continue
                if not self.reserve(db, 'task:' + task['id'], worker, task['budget_cents']):
                    db.execute("UPDATE tasks SET status='budget_blocked' WHERE id=?", (task['id'],))
                    continue
                task['deadline'] = self.config['deadline']
                db.execute("UPDATE tasks SET status='running',heartbeat=? WHERE id=?", (time.time(), task['id']))
                return {'task': task}
            return {'task': None}
    def update(self, worker, task_id, result=None):
        with self.db() as db:
            row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if not row or json.loads(row['payload'])['worker'] != worker:
                raise ValueError('Task not assigned to this worker')
            if result is None:
                db.execute("UPDATE tasks SET heartbeat=? WHERE id=? AND status='running'", (time.time(), task_id))
            elif row['status'] == 'running':
                status = 'completed' if result.get('ok') else 'blocked'
                db.execute('UPDATE tasks SET status=?,result=?,heartbeat=? WHERE id=?', (status, json.dumps(result), time.time(), task_id))
                if status == 'blocked' and worker == 'cursor' and self.config.get('pause_cursor_on_failure', True):
                    self.pause_worker(db, worker, 'Cursor task failed; resume requires operator inspection')
            self.refresh_failures(db)
            return {'stop': self.stopped(db)}
    def status(self):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self.refresh_failures(db)
            return {'stopped': self.stopped(db), 'deadline': self.config['deadline'],
                    'usable_budget_cents': self.config['usable_budget_cents'],
                    'paused_workers': {r['key'].split(':',1)[1]:r['value'] for r in db.execute("SELECT * FROM control WHERE key LIKE 'paused:%'")},
                    'reserved_cents': db.execute('SELECT COALESCE(SUM(cents),0) FROM allocations').fetchone()[0],
                    'tasks': [dict(row) for row in db.execute('SELECT * FROM tasks ORDER BY rowid')]}
    def set_status(self, task_id, status):
        with self.db() as db:
            db.execute('UPDATE tasks SET status=? WHERE id=?', (status, task_id))
    def reserve_conflict_repair(self, task_id):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            return not self.stopped(db) and self.reserve(
                db, 'conflict-repair:' + task_id, 'orchestrator',
                self.config.get('conflict_repair_budget_cents', 1000))

    def reserve_review(self, task_id):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            return not self.stopped(db) and self.reserve(db, 'review:' + task_id, 'orchestrator', self.config['review_budget_cents'])


def validate_task(t):
    assert re.fullmatch(r'[a-zA-Z0-9_-]{1,60}', t['id']), 'Invalid task ID'
    assert t['worker'] in ('claude', 'cursor')
    assert re.fullmatch(r'[0-9a-f]{40}', t['base_commit']), 'Use a full commit SHA'
    assert isinstance(t['budget_cents'], int) and (t['budget_cents'] > 0 or (t['worker'] == 'cursor' and t['budget_cents'] == 0))
    assert 0 < t['timeout_seconds'] <= 7200
    assert isinstance(t['prompt'], str) and t['prompt'].strip()
    assert t['allowed_paths'] and all(isinstance(p,str) and p and not p.startswith('/') and '..' not in pathlib.PurePosixPath(p).parts for p in t['allowed_paths'])
    assert all(isinstance(cmd,list) and cmd and all(isinstance(v,str) for v in cmd) for cmd in t.get('checks',[])), 'Checks are argument arrays, not shell strings'


def handler(store, tokens):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # No tokens/request bodies in console logs.
        def do_POST(self):
            role = next((role for role, token in tokens.items()
                         if secrets.compare_digest(self.headers.get('Authorization',''), 'Bearer ' + token)), None)
            if role is None:
                self.send_error(401)
                return
            try:
                length = int(self.headers.get('Content-Length','0'))
                if not 0 <= length <= 2_000_000:
                    raise ValueError('Payload too large')
                data = json.loads(self.rfile.read(length) or b'{}')
                if self.path == '/status':
                    out = store.status()
                    if role != 'admin':
                        out.pop('tasks')
                elif self.path == '/stop' and role == 'admin':
                    with store.db() as db:
                        db.execute("UPDATE control SET value='1' WHERE key='stopped'")
                    out = {'stopped': True}
                elif self.path == '/claim' and role != 'admin':
                    out = store.claim(role)
                elif self.path in ('/heartbeat', '/result') and role != 'admin':
                    out = store.update(role, data['id'], data.get('result') if self.path == '/result' else None)
                else:
                    self.send_error(403)
                    return
                payload = json.dumps(out).encode()
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (ValueError, KeyError, AssertionError) as error:
                self.send_error(400, str(error))
    return Handler


def api(config, route, body=None):
    token = os.environ[config['token_env']]
    req = urllib.request.Request(config['server'].rstrip('/') + route,
        data=json.dumps(body or {}).encode(), headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def claude_args(config, prompt, cents, readonly=False):
    tools = ['Read','Glob','Grep'] if readonly else config.get('claude_tools',['Read','Glob','Grep','Edit','Write','Bash'])
    args = [config.get('claude_binary','claude'),'-p','--output-format','json',
            '--max-budget-usd', f'{cents/100:.2f}', '--max-turns', str(config.get('max_turns',25)),
            '--tools', ','.join(tools), '--allowedTools', ','.join(tools)]
    if config.get('claude_model'):
        args += ['--model',config['claude_model']]
    return args + [prompt]


def response_text(path):
    value = read(path)
    if isinstance(value, list):
        value = next(v for v in reversed(value) if v.get('type') == 'result')
    if value.get('is_error'):
        raise RuntimeError('Claude reported an error; inspect its local log')
    return value['result']


def json_text(text):
    text = text.strip()
    if text.startswith('```'):
        text = '\n'.join(text.splitlines()[1:-1])
    return json.loads(text)


def check_paths(repo, base, commit, allowed):
    paths = run(['git','diff','--name-only',base,commit], repo).splitlines()
    for path in paths:
        if not any(path == prefix.rstrip('/') or path.startswith(prefix.rstrip('/') + '/') for prefix in allowed):
            raise RuntimeError('Changed path outside task scope: ' + path)
    return paths


def check_commands(task, repo, directory, cancel, remaining):
    logs = []
    for i, command in enumerate(task.get('checks', [])):
        log = directory / f'check-{i}.log'
        code = execute(command, repo, log, min(600, max(1,remaining())), cancel)
        logs.append({'command':command,'exit_code':code})
        if code:
            raise RuntimeError(f'Check failed ({code}): {command}. See {log}')
    return logs


def worker(config):
    if os.name != 'posix':
        raise RuntimeError('Use macOS/Linux or WSL on Windows')
    billing_guard(config)
    if config['worker'] == 'cursor' and not config.get('cursor_provider_limit_confirmed'):
        raise RuntimeError('Set Cursor provider spending controls, then acknowledge them in worker config')
    root = pathlib.Path(config['workspace']).expanduser().resolve()
    root.mkdir(parents=True,exist_ok=True)
    # Prevent duplicate workers using the same local workspace.
    import fcntl
    with open(root / '.runner.lock','w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            try:
                reply = api(config,'/claim')
            except (OSError, urllib.error.URLError):
                print('Coordinator unavailable; no new tasks will start.',flush=True)
                time.sleep(15)
                continue
            if reply.get('stop'):
                print(reply.get('reason', 'Coordinator stopped or deadline reached.'),flush=True)
                return
            task = reply.get('task')
            if task is None:
                time.sleep(10)
                continue
            task_dir = root / task['id']
            task_dir.mkdir(exist_ok=False)
            stop, finished = threading.Event(), threading.Event()
            expires = min(time.time()+task['timeout_seconds'], epoch(task['deadline']))
            def remaining():
                return expires - time.time()
            def cancel():
                return stop.is_set() or remaining() <= 0
            def heartbeat():
                last_success = time.time()
                while not finished.is_set():
                    try:
                        if api(config,'/heartbeat',{'id':task['id']}).get('stop'):
                            stop.set()
                        last_success = time.time()
                    except (OSError, urllib.error.URLError):
                        if time.time() - last_success > 60:
                            stop.set()
                    finished.wait(10)
            thread = threading.Thread(target=heartbeat,daemon=True)
            thread.start()
            branch = f"overnight/{config['worker']}/{task['id']}"
            repo = task_dir / 'repo'
            result = {'ok':False,'branch':branch,'base_commit':task['base_commit']}
            try:
                print('Starting',task['id'],flush=True)
                run(['git','clone','--no-checkout',config['repo_url'],str(repo)])
                run(['git','checkout','-b',branch,task['base_commit']],repo)
                for i, command in enumerate(config.get('setup_commands', [])):
                    code = execute(command, repo, task_dir / f'setup-{i}.log', min(600,max(1,remaining())), cancel)
                    if code:
                        raise RuntimeError('Project dependency setup failed')
                prompt = ('Implement only this task. Do not commit, push, change branches, spawn agents, or modify files outside allowed_paths. '
                          'Do not change test requirements to make failures pass. User explicitly authorized the supervisor to merge reviewed, CI-green PRs into lanes and main for this run; do not perform those Git operations yourself. End with a short summary and blockers.\n' + json.dumps(task,indent=2))
                if config['worker'] == 'claude':
                    args = claude_args(config,prompt,task['budget_cents'])
                else:
                    args = [config.get('cursor_binary','agent'),'-p','--force','--output-format','json']
                    if config.get('cursor_model'):
                        args += ['--model',config['cursor_model']]
                    args += [prompt]
                code = execute(args, repo, task_dir / 'agent.log', max(1,remaining()), cancel)
                if config['worker'] == 'claude' and code == 0:
                    response_text(task_dir / 'agent.log')
                if code or cancel():
                    raise RuntimeError(f'Agent stopped with exit code {code}; inspect agent.log')
                if run(['git','rev-parse','HEAD'],repo) != task['base_commit']:
                    raise RuntimeError('Agent changed HEAD; preserve workspace for inspection')
                run(['git','add','-A'],repo)
                if not run(['git','diff','--cached','--name-only'],repo):
                    raise RuntimeError('No code changes produced')
                run(['git','-c','user.name=Overnight Worker','-c','user.email=overnight@localhost',
                     'commit','-m',f"Overnight task {task['id']}"],repo)
                commit = run(['git','rev-parse','HEAD'],repo)
                check_paths(repo,task['base_commit'],commit,task['allowed_paths'])
                checks = check_commands(task,repo,task_dir,cancel,remaining)
                if run(['git','status','--porcelain'],repo):
                    raise RuntimeError('Checks left uncommitted changes; inspect workspace')
                if cancel():
                    raise RuntimeError('Deadline/stop reached before push')
                run(['git','push','origin',f'HEAD:refs/heads/{branch}'],repo)
                result.update(ok=True,commit=commit,checks=checks)
            except Exception as error:
                result['error'] = str(error)[-4000:]
                print('Blocked',task['id'],type(error).__name__,flush=True)
            finally:
                finished.set()
                thread.join(timeout=16)
            write(task_dir / 'result.json',result)
            # Report retries don't relaunch the agent or release its reservation.
            while True:
                try:
                    api(config,'/result',{'id':task['id'],'result':result})
                    break
                except (OSError, urllib.error.URLError):
                    if time.time() >= epoch(task['deadline']) + 300:
                        print('Result retained locally; coordinator unavailable.',flush=True)
                        return
                    time.sleep(10)
            if config['worker'] == 'cursor' and not result['ok'] and config.get('pause_on_failure',True):
                print('Cursor worker stopped after failure. Other workers continue.',flush=True)
                return


def repair_conflict(store, config, task, repo, directory, before, operation="cherry-pick"):
    conflicts = run(['git','diff','--name-only','--diff-filter=U'],repo).splitlines()
    if not conflicts or not config.get('auto_resolve_conflicts',True):
        raise RuntimeError('Cherry-pick failed; automatic conflict repair unavailable')
    if not store.reserve_conflict_repair(task['id']):
        raise RuntimeError('No orchestrator budget remains for conflict repair')
    budget = config.get('conflict_repair_budget_cents',1000)
    untracked_before = set(run(['git','ls-files','--others','--exclude-standard'],repo).splitlines())
    prompt = ('Resolve only the merge conflicts in the listed files in this integration checkout. '
              'Preserve the behavior from BOTH the already-integrated code and the incoming task. '
              'Read the conflict markers and surrounding implementation. Do not choose an entire side '
              'merely to remove markers. Do not modify other files, test expectations, Git metadata, '
              'or configuration. Do not commit, stage, run Git, spawn agents, or push. '
              'If the intended combined behavior is ambiguous, stop and return a blocker. '
              'Return ONLY JSON: {"resolved":true or false,"summary":"explanation"}.\n'
              + json.dumps({'conflicted_files':conflicts,'incoming_task':task},indent=2))
    repair_config = dict(config,claude_tools=['Read','Glob','Grep','Edit','Write'],
                         max_turns=config.get('conflict_repair_max_turns',20))
    remaining = lambda: epoch(config['deadline']) - time.time()
    cancel = lambda: store.status()['stopped']
    code = execute(claude_args(repair_config,prompt,budget),repo,directory/'conflict-repair.log',
                   min(config.get('conflict_repair_timeout_seconds',600),max(1,remaining())),cancel)
    if code or cancel():
        raise RuntimeError('Conflict repair failed or timed out; inspect conflict-repair.log')
    result = json_text(response_text(directory/'conflict-repair.log'))
    write(directory/'conflict-repair.json',dict(result,files=conflicts,budget_cents=budget))
    if result.get('resolved') is not True:
        raise RuntimeError('Conflict repair could not resolve: '+str(result.get('summary','')))
    if run(['git','rev-parse','HEAD'],repo) != before:
        raise RuntimeError('Repair agent changed HEAD')
    changed = set(run(['git','diff','--name-only'],repo).splitlines())
    if changed - set(conflicts):
        raise RuntimeError('Repair changed files outside the conflict list')
    untracked_after = set(run(['git','ls-files','--others','--exclude-standard'],repo).splitlines())
    if untracked_after - untracked_before:
        raise RuntimeError('Repair created unapproved files')
    for path in conflicts:
        target = repo / path
        if target.exists():
            content = target.read_text()
            if re.search(r'^(?:<{7}(?: |$)|>{7}(?: |$)|\|{7}(?: |$)|={7}$)',content,re.MULTILINE):
                raise RuntimeError('Conflict markers remain in '+path)
    run(['git','add','--'] + conflicts,repo)
    if run(['git','diff','--name-only','--diff-filter=U'],repo):
        raise RuntimeError('Unmerged index entries remain')
    run(['git','-c','user.name=Overnight Integrator','-c','user.email=overnight@localhost',
         '-c','core.editor=true',operation,'--continue'],repo)
    check_paths(repo,before,run(['git','rev-parse','HEAD'],repo),task['allowed_paths'])
    print('Resolved conflict for',task['id'],flush=True)


SIM_PATHS = ['packages/simulation','packages/knowledge','packages/forecast','packages/navigation',
             'packages/agents','packages/communication','packages/replay','apps/server']

def billing_guard(config):
    if config.get('require_billing_confirmation') and not config.get('provider_billing_confirmed'):
        raise RuntimeError('Provider billing controls are not confirmed. See README before enabling provider_billing_confirmed.')

def validate_lane_task(task, config):
    allowed = SIM_PATHS if task['worker']=='claude' else ['apps/web']
    if task.get('depends_on'):
        raise ValueError('This conservative run accepts independent tasks only')
    if len(task['prompt']) > 8000 or len(task.get('read_paths',[])) > 8:
        raise ValueError('Task context exceeds the conservative brief limit')
    for path in task['allowed_paths']:
        if not any(path.rstrip('/')==p or path.startswith(p+'/') for p in allowed):
            raise ValueError('Task path outside its lane: '+path)
    if task['worker']=='cursor' and task['budget_cents']!=0:
        raise ValueError('Cursor must have zero paid allocation')
    if task['worker']=='claude' and task['budget_cents']>config.get('max_task_budget_cents',1200):
        raise ValueError('Task exceeds per-session dollar cap')
    if task['timeout_seconds']>config.get('max_task_timeout_seconds',2700):
        raise ValueError('Task exceeds time cap')
    expected = [['pnpm','typecheck'],['pnpm','lint'],['pnpm','test']]
    if task.get('checks')!=expected:
        raise ValueError('Every task must run the three repository CI checks')


def guarded_merge(config, url, head, base, repo, cancel, base_head=None):
    """No admin bypass, direct main push, force push, or unchecked merge."""
    gh=config.get('gh_binary','gh')
    end=min(time.time()+config.get('ci_timeout_seconds',1800),epoch(config['deadline']))
    expected={name.lower() for name in config.get('required_ci_names',['Typecheck','Lint','Test'])}
    while time.time()<end and not cancel():
        pr=json.loads(run([gh,'pr','view',url,'--repo',config['github_repo'],
                          '--json','headRefOid,baseRefName,state,mergeStateStatus'],repo))
        if pr['headRefOid']!=head or pr['baseRefName']!=base:
            raise RuntimeError('PR head/base changed; refusing merge')
        if pr['state']=='MERGED': return
        if pr['state']!='OPEN': raise RuntimeError('PR is not open')
        proc=subprocess.run([gh,'pr','checks',url,'--repo',config['github_repo'],'--json','name,bucket'],
                            cwd=repo,text=True,capture_output=True,timeout=45)
        try: checks=json.loads(proc.stdout)
        except ValueError: raise RuntimeError('Unable to retrieve GitHub CI checks')
        names={check['name'].lower() for check in checks}
        if any(check['bucket'] in ('fail','cancel') for check in checks):
            raise RuntimeError('GitHub CI failed or was cancelled; no merge')
        if expected.issubset(names) and checks and all(check['bucket']=='pass' for check in checks):
            if cancel(): raise RuntimeError('Stopped before merge')
            if base_head is not None:
                remote = run(['git','ls-remote','origin','refs/heads/'+base],repo).split()
                if not remote or remote[0] != base_head:
                    raise RuntimeError('Target branch advanced since validation; refusing stale merge')
            run([gh,'pr','merge',url,'--repo',config['github_repo'],'--merge','--match-head-commit',head],repo)
            after=json.loads(run([gh,'pr','view',url,'--repo',config['github_repo'],'--json','state'],repo))
            if after['state']!='MERGED':
                raise RuntimeError('GitHub has not completed the merge; inspect repository protections/queue')
            return
        time.sleep(config.get('ci_poll_seconds',15))
    raise RuntimeError('GitHub checks missing/pending, stopped, or deadline reached; no merge')


def promote_main(store,config,task,lane,directory):
    promotion=dict(task,id=task['id']+'-main')
    if not store.reserve_review(promotion['id']):
        raise RuntimeError('No orchestrator budget for main promotion review')
    folder=directory/'main-promotion'; folder.mkdir(exist_ok=True)
    repo=folder/'repo'; run(['git','clone','--no-checkout',config['repo_url'],str(repo)])
    run(['git','fetch','origin','refs/heads/main'],repo)
    before=run(['git','rev-parse','FETCH_HEAD'],repo)
    branch='overnight/main/'+task['id']
    run(['git','checkout','-b',branch,before],repo)
    run(['git','fetch','origin',f'refs/heads/{lane}'],repo)
    lane_head=run(['git','rev-parse','FETCH_HEAD'],repo)
    # Only promote this task's lane-owned paths; unrelated pending lane changes block promotion.
    ancestor=run(['git','merge-base',before,lane_head],repo)
    check_paths(repo,ancestor,lane_head,task['allowed_paths'])
    try:
        run(['git','-c','user.name=Overnight Integrator','-c','user.email=overnight@localhost',
             'merge','--no-ff','--no-edit',lane_head],repo)
    except subprocess.CalledProcessError:
        repair_conflict(store,config,promotion,repo,folder,before,operation='merge')
    remaining=lambda: epoch(config['deadline'])-time.time()
    cancel=lambda: store.status()['stopped']
    for i,command in enumerate(config.get('setup_commands',[])):
        code=execute(command,repo,folder/f'setup-{i}.log',min(600,max(1,remaining())),cancel)
        if code: raise RuntimeError('Main promotion setup failed')
    prompt=('Review this task combined with current main. Inspect the changed files and relevant interfaces. '
            'User explicitly authorized automatic merges into main for this run. Do not modify anything. '
            'Return ONLY JSON: {"accept":true or false,"reason":"brief explanation"}.\n'+json.dumps(task)+
            '\nChanged files:\n'+run(['git','diff','--stat',before,'HEAD'],repo))
    code=execute(claude_args(config,prompt,config['review_budget_cents'],True),repo,folder/'review.log',min(480,max(1,remaining())),cancel)
    if code: raise RuntimeError('Main promotion review failed')
    verdict=json_text(response_text(folder/'review.log'));write(folder/'review.json',verdict)
    if verdict.get('accept') is not True: raise RuntimeError('Main promotion review rejected')
    check_commands(task,repo,folder,cancel,remaining)
    if run(['git','status','--porcelain'],repo) or cancel(): raise RuntimeError('Dirty checkout or stop before main PR')
    head=run(['git','rev-parse','HEAD'],repo)
    check_paths(repo,before,head,task['allowed_paths'])
    run(['git','push','origin',f'HEAD:refs/heads/{branch}'],repo)
    body=folder/'body.md';body.write_text('Promotes the accepted '+lane+' task into current main.\n\n'
        'Claude combined-code review and pnpm typecheck/lint/test passed locally.\n'
        'Automatic merge requires the three GitHub CI checks and existing protections.\n')
    url=run([config.get('gh_binary','gh'),'pr','create','--repo',config['github_repo'],
             '--base','main','--head',branch,'--title','[overnight] '+task['id']+' into main','--body-file',str(body)],repo)
    write(folder/'publication.json',dict(pr=url,branch=branch,head=head))
    guarded_merge(config,url,head,'main',repo,cancel,before)
    print('Main merged',task['id'],flush=True)


def lane_review_loop(store, config):
    """Review each task in an isolated checkout; publish only a draft PR to its lane."""
    root = pathlib.Path(config['workspace']).expanduser().resolve()
    root.mkdir(parents=True,exist_ok=True)
    while True:
        state = store.status()
        write(root/'report.json',state)
        if state['stopped']:
            return
        for row in state['tasks']:
            if row['status']!='completed':
                continue
            task,result=json.loads(row['payload']),json.loads(row['result'])
            if not store.reserve_review(task['id']):
                store.set_status(task['id'],'review_budget_blocked'); continue
            store.set_status(task['id'],'reviewing')
            directory=root/task['id']; directory.mkdir(exist_ok=True)
            repo=directory/'repo'
            lane='lane/sim' if task['worker']=='claude' else 'lane/web'
            branch='overnight/review/'+task['worker']+'/'+task['id']
            before=None
            remaining=lambda: epoch(config['deadline'])-time.time()
            cancel=lambda: store.status()['stopped']
            try:
                original_branch='overnight/'+task['worker']+'/'+task['id']
                if result['branch']!=original_branch or not re.fullmatch(r'[0-9a-f]{40}',result['commit']):
                    raise RuntimeError('Unexpected worker result')
                run(['git','clone','--no-checkout',config['repo_url'],str(repo)])
                run(['git','fetch','origin',f'refs/heads/{original_branch}'],repo)
                if run(['git','rev-parse','FETCH_HEAD'],repo)!=result['commit']:
                    raise RuntimeError('Branch changed since worker report')
                if run(['git','rev-parse',result['commit']+'^'],repo)!=task['base_commit']:
                    raise RuntimeError('Expected exactly one worker commit')
                check_paths(repo,task['base_commit'],result['commit'],task['allowed_paths'])
                run(['git','fetch','origin',f'refs/heads/{lane}'],repo)
                before=run(['git','rev-parse','FETCH_HEAD'],repo)
                run(['git','checkout','-b',branch,before],repo)
                try:
                    run(['git','-c','user.name=Overnight Integrator','-c','user.email=overnight@localhost','cherry-pick',result['commit']],repo)
                except subprocess.CalledProcessError:
                    repair_conflict(store,config,task,repo,directory,before)
                for i,command in enumerate(config.get('setup_commands',[])):
                    code=execute(command,repo,directory/f'setup-{i}.log',min(600,max(1,remaining())),cancel)
                    if code: raise RuntimeError('Review dependency setup failed')
                prompt=('Review only this task and its changed files against its acceptance criteria and AGENTS.md. '
                        'Read related interfaces only as needed. Do not load all architecture docs or unrelated packages. '
                        'Do not edit. Return ONLY JSON: {"accept":true or false,"reason":"brief explanation"}.\n'
                        +json.dumps(task)+'\nChanged files:\n'+run(['git','diff','--stat',before,'HEAD'],repo))
                code=execute(claude_args(config,prompt,config['review_budget_cents'],True),repo,directory/'review.log',min(480,max(1,remaining())),cancel)
                if code: raise RuntimeError('Review failed')
                review=json_text(response_text(directory/'review.log')); write(directory/'review.json',review)
                if review.get('accept') is not True: raise RuntimeError('Review rejected: '+str(review.get('reason','')))
                checks=check_commands(task,repo,directory,cancel,remaining)
                if run(['git','status','--porcelain'],repo): raise RuntimeError('Checks left changes')
                if cancel(): raise RuntimeError('Stopped before publishing')
                run(['git','push','origin',f'HEAD:refs/heads/{branch}'],repo)
                lane_label='sim' if task['worker']=='claude' else 'web'
                body=directory/'pr-body.md'
                body.write_text('Implements the bounded overnight task below.\n\n'+task['prompt']+
                                '\n\nValidation: pnpm typecheck, pnpm lint, pnpm test passed locally.\n'
                                'Claude review accepted. CI still requires verification before merging.\n'
                                'Prepared by the overnight runner; automatic merging requires matching head SHA and passing GitHub checks.\n')
                create=[config.get('gh_binary','gh'),'pr','create','--repo',config['github_repo'],
                        '--base',lane,'--head',branch,'--title',f'[lane/{lane_label}] {task["id"]}',
                        '--body-file',str(body)]
                if not config.get('auto_merge_lanes'): create.append('--draft')
                url=run(create,repo)
                write(directory/'publication.json',dict(pr=url,branch=branch,lane=lane,checks=checks))
                if config.get('auto_merge_lanes'):
                    head=run(['git','rev-parse','HEAD'],repo)
                    guarded_merge(config,url,head,lane,repo,cancel,before)
                    store.set_status(task['id'],'lane_merged')
                    print('Lane merged',task['id'],flush=True)
                    if config.get('auto_merge_main'):
                        try:
                            promote_main(store,config,task,lane,directory)
                            store.set_status(task['id'],'main_merged')
                        except Exception as error:
                            write(directory/'main-error.json',{'error':str(error)[-4000:]})
                            store.set_status(task['id'],'lane_merged_main_blocked')
                else:
                    store.set_status(task['id'],'ready_for_review')
                    print('Draft PR ready',task['id'],flush=True)
            except Exception as error:
                write(directory/'integration-error.json',{'error':str(error)[-4000:]})
                # Each failed task has its own checkout, so it cannot poison the next review.
                with contextlib.suppress(Exception):
                    run(['git','cherry-pick','--abort'],repo)
                    if before: run(['git','reset','--hard',before],repo)
                store.set_status(task['id'],'integration_blocked')
                print('Task review blocked',task['id'],flush=True)
        if all(r['status'] not in ('ready','running','completed','reviewing') for r in store.status()['tasks']):
            return  # No paid calls/polling once this fixed batch is complete.
        time.sleep(5)


def review_loop(store, config):
    root = pathlib.Path(config['workspace']).expanduser().resolve()
    root.mkdir(parents=True,exist_ok=True)
    repo = root / 'integration'
    if not repo.exists():
        run(['git','clone',config['repo_url'],str(repo)])
        run(['git','checkout','-b',config['integration_branch'],config['base_commit']],repo)
    else:
        if run(['git','branch','--show-current'],repo) != config['integration_branch'] or run(['git','status','--porcelain'],repo):
            raise RuntimeError('Integration checkout must be clean and on configured branch')
    while True:
        state = store.status()
        write(root / 'report.json',state)
        if state['stopped']:
            return
        for row in state['tasks']:
            if run(['git','status','--porcelain'],repo):
                raise RuntimeError('Integration checkout has leftover files; inspect before continuing')
            if row['status'] != 'completed':
                continue
            task, result = json.loads(row['payload']),json.loads(row['result'])
            if not store.reserve_review(task['id']):
                store.set_status(task['id'],'review_budget_blocked')
                continue
            store.set_status(task['id'],'reviewing')
            directory = root / task['id']
            directory.mkdir(exist_ok=True)
            before = run(['git','rev-parse','HEAD'],repo)
            cherry_picked = False
            try:
                branch = result['branch']
                if branch != f"overnight/{task['worker']}/{task['id']}" or not re.fullmatch(r'[0-9a-f]{40}',result['commit']):
                    raise RuntimeError('Unexpected result branch or commit')
                run(['git','fetch','origin',f'refs/heads/{branch}'],repo)
                if run(['git','rev-parse','FETCH_HEAD'],repo) != result['commit']:
                    raise RuntimeError('Pushed branch differs from reported SHA')
                if run(['git','rev-parse',result['commit']+'^'],repo) != task['base_commit']:
                    raise RuntimeError('Expected exactly one worker commit')
                check_paths(repo,task['base_commit'],result['commit'],task['allowed_paths'])
                try:
                    run(['git','-c','user.name=Overnight Integrator','-c','user.email=overnight@localhost',
                         'cherry-pick',result['commit']],repo)
                except subprocess.CalledProcessError:
                    # Flag before repair so any failed resolution is rolled back.
                    cherry_picked = True
                    repair_conflict(store,config,task,repo,directory,before)
                cherry_picked = True
                for i, command in enumerate(config.get('setup_commands', [])):
                    code = execute(command, repo, directory / f'setup-{i}.log', 600, lambda: store.status()['stopped'])
                    if code:
                        raise RuntimeError('Integration dependency setup failed')
                prompt = ('Review the currently checked-out change. Read relevant source files. Do not modify anything. '
                          'Check correctness, task acceptance criteria, and integration with surrounding code. '
                          'Return ONLY JSON: {"accept":true or false,"reason":"brief explanation"}.\n'
                          + json.dumps(task) + '\nChange:\n' + run(['git','diff','--stat',before,'HEAD'],repo)
                          + '\nInspect the changed files listed above using Read. Do not assume passing checks means correctness.')
                remaining = lambda: epoch(config['deadline']) - time.time()
                cancel = lambda: store.status()['stopped']
                code = execute(claude_args(config,prompt,config['review_budget_cents'],True),repo,
                               directory / 'review.log',min(600,max(1,remaining())),cancel)
                if code:
                    raise RuntimeError('Review CLI failed; inspect review.log')
                review = json_text(response_text(directory / 'review.log'))
                write(directory / 'review.json',review)
                if review.get('accept') is not True:
                    raise RuntimeError('Review rejected: '+str(review.get('reason','')))
                combined = dict(task,checks=task.get('checks',[]) + config.get('integration_checks',[]))
                check_commands(combined,repo,directory,cancel,remaining)
                if run(['git','status','--porcelain'],repo):
                    raise RuntimeError('Integration checks left changes')
                if cancel():
                    raise RuntimeError('Stopped before publishing integration branch')
                run(['git','push','origin',f"HEAD:refs/heads/{config['integration_branch']}"],repo)
                store.set_status(task['id'],'integrated')
                print('Integrated',task['id'],flush=True)
            except Exception as error:
                write(directory / 'integration-error.json',{'error':str(error)[-4000:]})
                # Preserve rejected edits before restoring this disposable checkout.
                with contextlib.suppress(Exception):
                    (directory/'rejected-change.diff').write_text(run(['git','diff','HEAD'],repo))
                    extras = run(['git','ls-files','--others','--exclude-standard'],repo).splitlines()
                    for path in extras:
                        source = repo / path
                        if source.is_file() or source.is_symlink():
                            destination = directory / 'rejected-files' / path
                            destination.parent.mkdir(parents=True,exist_ok=True)
                            source.rename(destination)
                with contextlib.suppress(Exception):
                    run(['git','cherry-pick','--abort'],repo)
                # Only this disposable integration checkout is reset; main is never touched.
                if cherry_picked:
                    run(['git','reset','--hard',before],repo)
                store.set_status(task['id'],'integration_blocked')
                print('Integration blocked',task['id'],flush=True)
        time.sleep(5)


def coordinator(config, no_review=False):
    import fcntl
    lock_path = pathlib.Path(config['workspace']).expanduser().resolve()
    lock_path.mkdir(parents=True,exist_ok=True)
    coordinator_lock = open(lock_path / '.coordinator.lock','w')
    fcntl.flock(coordinator_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    billing_guard(config)
    tokens = {role:os.environ[name] for role,name in config['token_envs'].items()}
    if any(len(t) < 24 for t in tokens.values()) or len(set(tokens.values())) != len(tokens):
        raise RuntimeError('Use distinct randomly generated tokens of at least 24 characters')
    assert sum(config['allocations_cents'].values()) <= config['usable_budget_cents']
    root = pathlib.Path(config['workspace']).expanduser().resolve()
    root.mkdir(parents=True,exist_ok=True)
    store = Store(root / 'state.sqlite',config)
    store.add(read(config['tasks_file']))
    server = http.server.ThreadingHTTPServer((config['bind'],config['port']),handler(store,tokens))
    thread = threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    print(f"Coordinator listening on {config['bind']}:{config['port']}. Deadline: {config['deadline']}",flush=True)
    try:
        if no_review:
            while not store.status()['stopped']:
                write(root / 'report.json',store.status())
                time.sleep(5)
        else:
            (lane_review_loop if config.get('lane_mode') else review_loop)(store,config)
    finally:
        with store.db() as db:
            db.execute("UPDATE control SET value='1' WHERE key='stopped'")
        # Keep endpoint available briefly so heartbeats can cancel active workers.
        write(root / 'report.json',store.status())
        server.shutdown()
        server.server_close()


def plan(config, requirements, output):
    billing_guard(config)
    root = pathlib.Path(config['workspace']).expanduser().resolve()
    root.mkdir(parents=True,exist_ok=True)
    store = Store(root/'state.sqlite',config)
    with store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        key = 'plan:' + secrets.token_hex(8)
        if store.stopped(db) or not store.reserve(db,key,'orchestrator',config['plan_budget_cents']):
            raise RuntimeError('No planning budget remains or run is stopped')
    prompt = ('You are planning work for one Claude coding worker and one Cursor coding worker. '
              'Return ONLY a JSON array of at most 4 independent, bounded tasks. '
              'Each object must have id, worker (claude/cursor), base_commit, prompt, allowed_paths '
              '(repository-relative files or folders), budget_cents, timeout_seconds, checks '
              '(arrays of command arguments), depends_on (task IDs). Prefer independent tasks with disjoint paths. '
              'Every task must start from the supplied base_commit. Define shared interfaces explicitly. '
              'Cursor uses only included free usage: its task budget_cents MUST be 0. Never enable paid fallback. '
              'Do not modify files. Total task budgets per worker cannot exceed allocations below. '
              'Do not invent project-specific test commands; use only ones established by reading the repo.\n'
              + json.dumps({'base_commit':config['base_commit'],'allocations_cents':config['allocations_cents']})
              + '\nRequirements:\n' + pathlib.Path(requirements).read_text())
    # Planning runs in an isolated read-only-tool clone, not the kit folder.
    repo = root / 'planning-repo'
    if not repo.exists():
        run(['git','clone','--no-checkout',config['repo_url'],str(repo)])
    run(['git','fetch','origin'],repo)
    run(['git','checkout','--detach',config['base_commit']],repo)
    log = root / (key.replace(':','-') + '.log')
    code = execute(claude_args(config,prompt,config['plan_budget_cents'],True),repo,log,600)
    if code:
        raise RuntimeError('Planner failed; inspect '+str(log))
    tasks = json_text(response_text(log))
    assert isinstance(tasks,list) and tasks
    for task in tasks:
        validate_task(task)
        assert task['base_commit'] == config['base_commit']
    assert len({t['id'] for t in tasks}) == len(tasks)
    for owner in ('claude','cursor'):
        assert sum(t['budget_cents'] for t in tasks if t['worker']==owner) <= config['allocations_cents'][owner]
    write(output,tasks)
    print('Plan written to',output,'— inspect task prompts and check commands before starting.')


def init(hours):
    deadline = (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=hours)).isoformat()
    config = {'repo_url':'git@github.com:YOUR_ACCOUNT/YOUR_REPO.git','base_commit':'REPLACE_WITH_FULL_SHA',
              'integration_branch':'overnight/integration-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S'),
              'bind':'127.0.0.1','port':8765,'deadline':deadline,'workspace':'./coordinator-state',
              'tasks_file':'tasks.json','usable_budget_cents':1700,
              'allocations_cents':{'claude':600,'cursor':600,'orchestrator':500},
              'plan_budget_cents':100,'review_budget_cents':100,'max_turns':20,
              'integration_checks':[],'setup_commands':[],'pause_cursor_on_failure':True,'worker_stale_seconds':180,
              'token_envs':{'admin':'OVERNIGHT_ADMIN_TOKEN','claude':'OVERNIGHT_CLAUDE_TOKEN','cursor':'OVERNIGHT_CURSOR_TOKEN'}}
    targets = ['coordinator.json','claude-worker.json','cursor-worker.json','admin.json','tokens.env','tasks.example.json']
    if any(pathlib.Path(p).exists() for p in targets):
        raise RuntimeError('Init would overwrite existing configuration; use a new kit directory')
    write('coordinator.json',config)
    for name in ('claude','cursor'):
        write(name+'-worker.json',{'worker':name,'server':'http://COORDINATOR_PRIVATE_IP:8765',
              'token_env':f'OVERNIGHT_{name.upper()}_TOKEN','repo_url':config['repo_url'],
              'workspace':f'./{name}-state','setup_commands':[],'max_turns':20,'cursor_provider_limit_confirmed':False,'pause_on_failure':True})
    write('admin.json',{'server':'http://127.0.0.1:8765','token_env':'OVERNIGHT_ADMIN_TOKEN'})
    token_file = pathlib.Path('tokens.env')
    token_file.write_text(''.join(f'export {name}={secrets.token_urlsafe(32)}\n' for name in config['token_envs'].values()))
    token_file.chmod(0o600)
    write('tasks.example.json',[{'id':'backend-01','worker':'claude','base_commit':'REPLACE_WITH_FULL_SHA',
          'prompt':'REPLACE with a precise task and acceptance criteria.','allowed_paths':['backend/'],
          'budget_cents':200,'timeout_seconds':1800,'checks':[],'depends_on':[]}])
    print('Created configs and private tokens.env. Edit repository, commit, server IP, and tasks before running.')


def prepare(config_path, server, hours):
    config = read(config_path)
    state = pathlib.Path(config['workspace']).expanduser().resolve()
    if (state / 'state.sqlite').exists() or pathlib.Path('tokens.env').exists():
        raise RuntimeError('This run has already been prepared. Preserve its state and limits; do not reset it.')
    if not 0 < hours <= 24:
        raise ValueError('Choose between 0 and 24 hours')
    parsed = urllib.parse.urlparse(server)
    if parsed.scheme != 'http' or parsed.port != config['port'] or parsed.path not in ('','/'):
        raise ValueError('Use http://PRIVATE_IP:8765 (private network only)')
    addr = ipaddress.ip_address(parsed.hostname)
    if not (addr.is_private or addr in ipaddress.ip_network('100.64.0.0/10')):
        raise ValueError('Use a private or Tailscale IP; do not expose this HTTP service publicly')
    config['bind'] = str(addr)
    config['deadline'] = (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=hours)).isoformat()
    config['integration_branch'] = 'overnight/integration-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    # Pin the supplied current commit; no automatic branch advancement.
    write(config_path,config)
    task_path = pathlib.Path(config['tasks_file'])
    if config.get('lane_mode') and task_path.exists():
        tasks = read(task_path)
        suffix = dt.datetime.now().strftime('%m%d%H%M%S')
        for task in tasks:
            task['id'] += '-' + suffix
        write(task_path,tasks)
    for name in ('claude','cursor'):
        worker_path = name + '-worker.json'
        worker_config = read(worker_path)
        worker_config['server'] = server.rstrip('/')
        worker_config['repo_url'] = config['repo_url']
        write(worker_path,worker_config)
    write('admin.json',{'server':server.rstrip('/'),'token_env':config['token_envs']['admin']})
    tokens = {role: secrets.token_urlsafe(32) for role in config['token_envs']}
    token_path = pathlib.Path('tokens.env')
    token_path.write_text(''.join('export '+config['token_envs'][role]+'='+token+'\n' for role,token in tokens.items()))
    token_path.chmod(0o600)
    for name in ('claude','cursor'):
        path = pathlib.Path(name+'-token.env')
        path.write_text('export '+config['token_envs'][name]+'='+tokens[name]+'\n')
        path.chmod(0o600)
    print('Prepared conservative Ember run. Review configured budgets and provider controls before starting.')
    print('Load tokens.env on the coordinator. Privately transfer only each worker token file to its laptop.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command',required=True)
    q = sub.add_parser('prepare'); q.add_argument('--config',default='coordinator.json'); q.add_argument('--server',required=True); q.add_argument('--hours',type=float,default=8)
    q = sub.add_parser('init'); q.add_argument('--hours',type=float,default=8)
    q = sub.add_parser('plan'); q.add_argument('--config',default='coordinator.json'); q.add_argument('--requirements',default='requirements.md'); q.add_argument('--output',default='tasks.json')
    q = sub.add_parser('coordinator'); q.add_argument('--config',default='coordinator.json'); q.add_argument('--no-review',action='store_true')
    q = sub.add_parser('worker'); q.add_argument('--config',required=True)
    for command in ('status','stop'):
        q = sub.add_parser(command); q.add_argument('--config',default='admin.json')
    args = p.parse_args()
    if args.command == 'prepare':
        prepare(args.config,args.server,args.hours)
    elif args.command == 'init':
        init(args.hours)
    elif args.command == 'plan':
        plan(read(args.config),args.requirements,args.output)
    elif args.command == 'coordinator':
        coordinator(read(args.config),args.no_review)
    elif args.command == 'worker':
        worker(read(args.config))
    else:
        print(json.dumps(api(read(args.config),'/'+args.command),indent=2))

if __name__ == '__main__':
    main()
