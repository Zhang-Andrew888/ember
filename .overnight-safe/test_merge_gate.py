import datetime as dt
import json
import pathlib
import subprocess
import unittest
from unittest.mock import patch
import overnight as o

class MergeGate(unittest.TestCase):
    def config(self):
        return dict(github_repo='test/repo',deadline=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=1)).isoformat(),ci_timeout_seconds=1,ci_poll_seconds=0)
    def test_passed_checks_merge_exact_head(self):
        commands=[]
        def run(args,*rest):
            commands.append(args)
            if args[1:3]==['pr','merge']: return ''
            if args[-1]=='state': return json.dumps({'state':'MERGED'})
            return json.dumps(dict(headRefOid='a'*40,baseRefName='main',state='OPEN',mergeStateStatus='CLEAN'))
        checks=[dict(name=n,bucket='pass') for n in ('Typecheck','Lint','Test')]
        with patch.object(o,'run',run), patch.object(o.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(checks),'')):
            o.guarded_merge(self.config(),'PR','a'*40,'main',pathlib.Path('.'),lambda:False)
        merge=next(a for a in commands if a[1:3]==['pr','merge'])
        self.assertIn('--match-head-commit',merge); self.assertNotIn('--admin',merge); self.assertNotIn('--auto',merge)
    def test_failed_ci_never_merges(self):
        commands=[]
        def run(args,*rest):
            commands.append(args)
            return json.dumps(dict(headRefOid='a'*40,baseRefName='main',state='OPEN',mergeStateStatus='CLEAN'))
        with patch.object(o,'run',run),patch.object(o.subprocess,'run',return_value=subprocess.CompletedProcess([],1,json.dumps([dict(name='Test',bucket='fail')]),'')):
            with self.assertRaises(RuntimeError): o.guarded_merge(self.config(),'PR','a'*40,'main',pathlib.Path('.'),lambda:False)
        self.assertFalse(any(a[1:3]==['pr','merge'] for a in commands))
    def test_changed_head_never_merges(self):
        with patch.object(o,'run',return_value=json.dumps(dict(headRefOid='b'*40,baseRefName='main',state='OPEN'))):
            with self.assertRaises(RuntimeError): o.guarded_merge(self.config(),'PR','a'*40,'main',pathlib.Path('.'),lambda:False)
    def test_advanced_target_never_merges(self):
        commands=[]
        def run(args,*rest):
            commands.append(args)
            if args[0]=='git': return 'b'*40+' refs/heads/main'
            return json.dumps(dict(headRefOid='a'*40,baseRefName='main',state='OPEN',mergeStateStatus='CLEAN'))
        checks=[dict(name=n,bucket='pass') for n in ('Typecheck','Lint','Test')]
        with patch.object(o,'run',run),patch.object(o.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(checks),'')):
            with self.assertRaises(RuntimeError): o.guarded_merge(self.config(),'PR','a'*40,'main',pathlib.Path('.'),lambda:False,'a'*40)
        self.assertFalse(any(a[1:3]==['pr','merge'] for a in commands))
    def test_required_approval_failure_is_not_bypassed(self):
        commands=[]
        def run(args,*rest):
            commands.append(args)
            if args[1:3]==['pr','merge']:
                raise subprocess.CalledProcessError(1,args,'Review required')
            return json.dumps(dict(headRefOid='a'*40,baseRefName='main',state='OPEN',mergeStateStatus='BLOCKED'))
        checks=[dict(name=n,bucket='pass') for n in ('Typecheck','Lint','Test')]
        with patch.object(o,'run',run),patch.object(o.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(checks),'')):
            with self.assertRaises(subprocess.CalledProcessError): o.guarded_merge(self.config(),'PR','a'*40,'main',pathlib.Path('.'),lambda:False)
        self.assertEqual(sum(a[1:3]==['pr','merge'] for a in commands),1)
        self.assertFalse(any('--admin' in a for a in commands))
    def test_missing_checks_never_merges(self):
        config=self.config(); config['ci_timeout_seconds']=.01
        commands=[]
        def run(args,*rest):
            commands.append(args)
            return json.dumps(dict(headRefOid='a'*40,baseRefName='main',state='OPEN',mergeStateStatus='CLEAN'))
        with patch.object(o,'run',run),patch.object(o.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'[]','')):
            with self.assertRaises(RuntimeError): o.guarded_merge(config,'PR','a'*40,'main',pathlib.Path('.'),lambda:False)
        self.assertFalse(any(a[1:3]==['pr','merge'] for a in commands))

if __name__=='__main__': unittest.main(verbosity=2)
