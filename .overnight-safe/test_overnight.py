import concurrent.futures, json, os, pathlib, tempfile, threading, time, unittest
import overnight as o

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.tmp.name)
        self.config={'deadline':(o.dt.datetime.now(o.dt.timezone.utc)+o.dt.timedelta(minutes=5)).isoformat(),
                     'usable_budget_cents':600,'allocations_cents':{'claude':200,'cursor':200,'orchestrator':200},'review_budget_cents':100}
        self.store=o.Store(self.root/'state.sqlite',self.config)
    def tearDown(self): self.tmp.cleanup()
    def task(self,name='one',worker='claude'):
        return dict(id=name,worker=worker,base_commit='a'*40,prompt='Add code',allowed_paths=['src/'],budget_cents=200,timeout_seconds=60,checks=[],depends_on=[])
    def test_atomic_claim_and_persistent_budget(self):
        self.store.add([self.task()])
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            replies=list(pool.map(lambda _:self.store.claim('claude'),range(6)))
        self.assertEqual(sum(bool(r.get('task')) for r in replies),1)
        self.store.update('claude','one',{'ok':False}); self.store.add([self.task('two')])
        self.assertIsNone(self.store.claim('claude')['task']); self.assertEqual(self.store.status()['reserved_cents'],200)
    def test_zero_paid_cursor_budget_can_run(self):
        self.config['allocations_cents']['cursor']=0
        task=self.task('free-cursor','cursor'); task['budget_cents']=0
        self.store.add([task])
        self.assertEqual(self.store.claim('cursor')['task']['id'],'free-cursor')
        self.assertEqual(self.store.status()['reserved_cents'],0)
    def test_each_claude_role_has_separate_70_dollar_cap(self):
        self.config.update(usable_budget_cents=14000,allocations_cents={'claude':7000,'cursor':0,'orchestrator':7000})
        with self.store.db() as db:
            self.assertTrue(self.store.reserve(db,'worker-full','claude',7000))
            self.assertFalse(self.store.reserve(db,'worker-extra','claude',1))
            self.assertTrue(self.store.reserve(db,'orchestrator-full','orchestrator',7000))
            self.assertFalse(self.store.reserve(db,'orchestrator-extra','orchestrator',1))
        self.assertEqual(self.store.status()['reserved_cents'],14000)
    def test_budget_change_cannot_reset_existing_run(self):
        config=dict(self.config,usable_budget_cents=9999)
        with self.assertRaises(RuntimeError): o.Store(self.root/'state.sqlite',config)
    def test_lane_paths_and_required_checks(self):
        task=self.task(); task['allowed_paths']=['packages/simulation/']
        task['checks']=[['pnpm','typecheck'],['pnpm','lint'],['pnpm','test']]
        o.validate_lane_task(task,{})
        task['allowed_paths']=['packages/domain/']
        with self.assertRaises(ValueError): o.validate_lane_task(task,{})
        task['allowed_paths']=['apps/web/']; task['worker']='cursor'; task['budget_cents']=0
        o.validate_lane_task(task,{})
    def test_provider_confirmation_guard(self):
        with self.assertRaises(RuntimeError): o.billing_guard({'require_billing_confirmation':True})
        o.billing_guard({'require_billing_confirmation':True,'provider_billing_confirmed':True})
    def test_wrong_worker(self):
        self.store.add([self.task()])
        with self.assertRaises(ValueError): self.store.update('cursor','one',{'ok':True})
    def test_dependency(self):
        a,b=self.task(),self.task('two','cursor'); b['depends_on']=['one']; self.store.add([a,b])
        self.assertIsNone(self.store.claim('cursor')['task'])
        self.store.set_status('one','completed'); self.assertIsNone(self.store.claim('cursor')['task'])
        self.store.set_status('one','integrated'); self.assertEqual(self.store.claim('cursor')['task']['id'],'two')
    def test_cursor_failure_blocks_only_dependents_and_cursor_queue(self):
        first=self.task('cursor-first','cursor')
        waiting=self.task('claude-dependent'); waiting['depends_on']=['cursor-first']
        self.store.add([first, waiting, self.task('claude-independent'),self.task('cursor-later','cursor')])
        self.store.claim('cursor'); self.store.update('cursor','cursor-first',{'ok':False,'error':'quota'})
        self.assertEqual(self.store.claim('claude')['task']['id'],'claude-independent')
        self.assertTrue(self.store.claim('cursor')['worker_only'])
        states={r['id']:r['status'] for r in self.store.status()['tasks']}
        self.assertEqual(states['claude-dependent'],'dependency_blocked')
        self.assertEqual(states['cursor-later'],'worker_unavailable')
        self.assertFalse(self.store.status()['stopped'])
    def test_stale_cursor_does_not_stop_claude(self):
        self.store.add([self.task('cursor-first','cursor'),self.task('claude-independent')])
        self.store.claim('cursor')
        with self.store.db() as db:
            db.execute('UPDATE tasks SET heartbeat=0 WHERE id=?',('cursor-first',))
        self.assertEqual(self.store.claim('claude')['task']['id'],'claude-independent')
        self.assertFalse(self.store.status()['stopped'])
    def test_deadline(self):
        self.config['deadline']='2000-01-01T00:00:00+00:00'; self.assertTrue(self.store.claim('claude')['stop'])
    def test_timeout(self):
        self.assertEqual(o.execute(['python3','-c','import time; time.sleep(30)'],self.root,self.root/'log',.2),124)
    def test_two_workers_integration(self):
        self.end_to_end(False)
    def test_cursor_quota_failure_does_not_stop_claude(self):
        self.end_to_end(True)
    def test_real_conflict_repaired_and_integrated(self):
        self.end_to_end(False,'success')
    def test_unresolved_conflict_rolls_back_without_global_stop(self):
        self.end_to_end(False,'reject')
    def test_repair_extra_file_is_retained_and_checkout_restored(self):
        self.end_to_end(False,'extra')
    def test_conflict_with_no_budget_does_not_call_repair(self):
        self.end_to_end(False,'budget')
    def test_lane_mode_prepares_separate_draft_prs(self):
        self.end_to_end(False,None,True)
    def test_automatic_lane_and_main_merges(self):
        self.end_to_end(False,None,'auto')
    def end_to_end(self,cursor_failure,conflict_mode=None,lane_mode=False):
        if lane_mode=='auto':
            self.config['allocations_cents']['orchestrator']=400
            self.config['usable_budget_cents']=800
        if conflict_mode:
            self.config['conflict_repair_budget_cents']=100
            if conflict_mode != 'budget':
                self.config['allocations_cents']['orchestrator']=300
                self.config['usable_budget_cents']=700
        bare,seed=self.root/'remote.git',self.root/'seed'
        o.run(['git','init','--bare',str(bare)]); o.run(['git','clone',str(bare),str(seed)])
        (seed/'src').mkdir(); (seed/'src'/'initial.py').write_text('values=[]\n'); (seed/'.gitignore').write_text('__pycache__/\n')
        o.run(['git','add','.'],seed); o.run(['git','-c','user.name=Test','-c','user.email=test@localhost','commit','-m','initial'],seed)
        o.run(['git','push','origin','HEAD'],seed); base=o.run(['git','rev-parse','HEAD'],seed)
        if lane_mode:
            o.run(['git','push','origin','HEAD:refs/heads/main'],seed)
            o.run(['git','push','origin','HEAD:refs/heads/lane/sim'],seed)
            o.run(['git','push','origin','HEAD:refs/heads/lane/web'],seed)
        fake=self.root/'fake-agent'
        fake.write_text('''#!/usr/bin/env python3
import json,pathlib,sys
prompt=sys.argv[-1]
if prompt.startswith('Resolve only'):
 rejected=pathlib.Path(__file__).with_name('reject-repair').exists()
 if not rejected: pathlib.Path('src/initial.py').write_text("values=['one','two']\\n")
 if pathlib.Path(__file__).with_name('extra-repair').exists(): pathlib.Path('unexpected.txt').write_text('retained')
 print(json.dumps({'result':json.dumps({'resolved':not rejected,'summary':'Test resolution'})}))
elif prompt.startswith('Review'):
 print(json.dumps({'result':json.dumps({'accept':True,'reason':'Test review'})}))
else:
 task=json.loads(prompt[prompt.index('{'):])
 if pathlib.Path(__file__).with_name('fail-cursor').exists() and task['worker']=='cursor':
  print('Free quota exhausted'); sys.exit(1)
 pathlib.Path('src/'+task['id']+'.py').write_text('value=2\\n')
 if pathlib.Path(__file__).with_name('make-conflict').exists():
  pathlib.Path('src/initial.py').write_text('values='+repr([task['id']])+'\\n')
 print(json.dumps({'result':'Implemented'}))
'''); fake.chmod(0o755)
        if cursor_failure: (self.root/'fail-cursor').touch()
        if conflict_mode: (self.root/'make-conflict').touch()
        if conflict_mode=='reject': (self.root/'reject-repair').touch()
        if conflict_mode=='extra': (self.root/'extra-repair').touch()
        tasks=[self.task(),self.task('two','cursor')]
        for t in tasks: t.update(base_commit=base,checks=[['python3','-m','compileall','-q','src']])
        self.store.add(tasks)
        expected = ['integrated','blocked'] if cursor_failure else ['integrated','integrated']
        if conflict_mode in ('reject','budget','extra'): expected=['integrated','integration_blocked']
        if lane_mode: expected=['main_merged','main_merged'] if lane_mode=='auto' else ['ready_for_review','ready_for_review']
        tokens={'admin':'admin-token','claude':'claude-token','cursor':'cursor-token'}
        server=o.http.server.ThreadingHTTPServer(('127.0.0.1',0),o.handler(self.store,tokens))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        threads=[]; errors=[]; old={}
        def launch(fn,*args):
            def target():
                try: fn(*args)
                except Exception as e: errors.append(e)
            t=threading.Thread(target=target,daemon=True); t.start(); threads.append(t)
        try:
            for name in ('claude','cursor'):
                key='OVERNIGHT_TEST_'+name.upper(); old[key]=os.environ.get(key); os.environ[key]=tokens[name]
                launch(o.worker,dict(worker=name,server=f'http://127.0.0.1:{server.server_port}',token_env=key,repo_url=str(bare),workspace=str(self.root/name),claude_binary=str(fake),cursor_binary=str(fake),cursor_provider_limit_confirmed=True))
            gh=self.root/'fake-gh'
            gh.write_text("""#!/usr/bin/env python3
import json,pathlib,subprocess,sys
path=pathlib.Path(__file__).with_suffix('.state')
state=json.loads(path.read_text()) if path.exists() else {}
args=sys.argv[1:]
pathlib.Path(__file__).with_suffix('.calls').open('a').write(repr(args)+'\\n')
if args[:2]==['pr','create']:
 n=str(len(state)+1); url='https://github.com/test/repo/pull/'+n
 state[url]={'headRefOid':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'baseRefName':args[args.index('--base')+1],'state':'OPEN','mergeStateStatus':'CLEAN'}
 path.write_text(json.dumps(state)); print(url)
elif args[:2]==['pr','checks']:
 print(json.dumps([{'name':n,'bucket':'pass'} for n in ['Typecheck','Lint','Test']]))
elif args[:2]==['pr','view']:
 print(json.dumps(state[args[2]]))
elif args[:2]==['pr','merge']:
 row=state[args[2]]; assert args[args.index('--match-head-commit')+1]==row['headRefOid']
 subprocess.check_call(['git','push','origin','HEAD:refs/heads/'+row['baseRefName']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 row['state']='MERGED';path.write_text(json.dumps(state))
else: raise RuntimeError(args)
"""); gh.chmod(0o755)
            launch(o.lane_review_loop if lane_mode else o.review_loop,self.store,dict(self.config,workspace=str(self.root/'review'),repo_url=str(bare),github_repo='test/repo',base_commit=base,integration_branch='overnight/integration',claude_binary=str(fake),gh_binary=str(gh),setup_commands=[],integration_checks=[],auto_merge_lanes=lane_mode=='auto',auto_merge_main=lane_mode=='auto',ci_poll_seconds=0))
            end=time.time()+40
            while time.time()<end and not errors:
                if sorted(t['status'] for t in self.store.status()['tasks']) == sorted(expected): break
                time.sleep(.2)
            self.assertEqual(errors,[]); self.assertEqual(sorted(t['status'] for t in self.store.status()['tasks']),sorted(expected))
            self.assertFalse(self.store.status()['stopped'])
            self.assertEqual(self.store.status()['reserved_cents'],500 if cursor_failure else (800 if lane_mode=='auto' else (700 if conflict_mode in ('success','reject','extra') else 600)))
            if lane_mode:
                calls=gh.with_suffix('.calls').read_text()
                self.assertIn('lane/sim',calls); self.assertIn('lane/web',calls)
                if lane_mode=='auto':
                    self.assertIn('merge',calls)
                    contents=o.run(['git','ls-tree','-r','--name-only','refs/heads/main'],bare)
                    self.assertIn('src/one.py',contents);self.assertIn('src/two.py',contents)
                else: self.assertNotIn('merge',calls)
                self.assertEqual(o.run(['git','rev-parse','refs/heads/master'],bare),base)
                return
            o.run(['git','fetch','origin','overnight/integration'],seed)
            names=o.run(['git','ls-tree','-r','--name-only','FETCH_HEAD'],seed)
            if conflict_mode in ('reject','budget','extra'):
                self.assertEqual(sum(name in names for name in ('src/one.py','src/two.py')),1)
                if conflict_mode=='budget':
                    self.assertEqual(list((self.root/'review').glob('*/conflict-repair.log')),[])
            else:
                self.assertIn('src/one.py',names)
                if cursor_failure: self.assertNotIn('src/two.py',names)
                else: self.assertIn('src/two.py',names)
            if conflict_mode=='extra':
                retained=list((self.root/'review').glob('*/rejected-files/unexpected.txt'))
                self.assertEqual(len(retained),1)
                self.assertEqual(retained[0].read_text(),'retained')
            if conflict_mode=='success':
                self.assertEqual(o.run(['git','show','FETCH_HEAD:src/initial.py'],seed),"values=['one','two']")
            self.assertEqual(o.run(['git','status','--porcelain'],self.root/'review'/'integration'),'')
        finally:
            with self.store.db() as db: db.execute("UPDATE control SET value='1' WHERE key='stopped'")
            for t in threads: t.join(timeout=16)
            server.shutdown(); server.server_close()
            for k,v in old.items():
                if v is None: os.environ.pop(k,None)
                else: os.environ[k]=v

if __name__=='__main__': unittest.main(verbosity=2)
