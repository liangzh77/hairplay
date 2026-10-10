#!/usr/bin/env python3
"""Linux-only isolated test: force publish HTTP failure after switching a first-SW release.
Never uses the real site root, Caddy, user database or secrets.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tarfile
import io
import release

source=Path(__file__).with_name('release-remote.sh').read_text()
with tempfile.TemporaryDirectory(prefix='hairplay-sw-rollback-') as tmp:
 root=Path(tmp)/'site'; releases=root/'releases';releases.mkdir(parents=True)
 oldid='20260101T000000Z';newid='20260102T000000Z';resetid='20260103T000000Z'
 old=releases/oldid;old.mkdir();(old/'index.html').write_text('old')
 reset=releases/resetid;reset.mkdir();(reset/'index.html').write_text('old')
 reset_worker=Path(os.environ.get('HAIRPLAY_TEST_RESET_WORKER',Path(__file__).resolve().parents[1]/'client/scripts/hairplay-images-sw-reset.js'))
 (reset/'hairplay-images-sw.js').write_bytes(reset_worker.read_bytes())
 (root/'current').symlink_to('releases/'+oldid)
 archive=Path(tmp)/'new.tgz'
 with tarfile.open(archive,'w:gz',format=tarfile.USTAR_FORMAT) as tar:
  for name,body in [('index.html',b'new'),('hairplay-images-sw.js',b'new-worker')]:
   entry=tarfile.TarInfo(name);entry.size=len(body);tar.addfile(entry,io.BytesIO(body))
 manifest=Path(tmp)/'new.json';manifest.write_text(json.dumps({'index.html':release.digest(b'new'),'hairplay-images-sw.js':release.digest(b'new-worker')}))
 reset_manifest=Path(tmp)/'reset.json';reset_manifest.write_text(json.dumps({'index.html':release.digest(b'old'),'hairplay-images-sw.js':release.digest(reset_worker.read_bytes())}))
 # Delegate archive and tree checks to the real release verifier; fail only the
 # external HTTP step deliberately, after the atomic publish has happened.
 checker=Path(tmp)/'checker.py'
 checker.write_text('import subprocess,sys\n'
  'sys.exit(1 if sys.argv[1]=="verify-http" else subprocess.call([sys.executable,'
  +repr(str(Path(__file__).with_name('release.py')))+',*sys.argv[1:]]))\n')
 modified=source.replace('root=/srv/sites/liangz77.cn/hairplay',f'root={root}',1)
 assert modified!=source
 runner=Path(tmp)/'publish.sh';runner.write_text(modified);runner.chmod(0o755)
 env={**os.environ,'HAIRPLAY_CACHE_RESET_RELEASE_ID':resetid,'HAIRPLAY_CACHE_RESET_MANIFEST':str(reset_manifest),
      'HAIRPLAY_CACHE_RESET_SHA256':hashlib.sha256(reset_worker.read_bytes()).hexdigest()}
 # Valid escaped JSON key must still trigger the first-worker reset requirement.
 escaped=Path(tmp)/'escaped.json';escaped.write_text(manifest.read_text().replace('hairplay-images-sw.js',r'hairplay-images-sw\u002ejs'))
 assert 'hairplay-images-sw.js' in json.loads(escaped.read_text())
 missing={k:v for k,v in env.items() if not k.startswith('HAIRPLAY_CACHE_RESET_')}
 refused_escape=subprocess.run(['bash',str(runner),'deploy',newid,str(escaped),str(checker),str(archive)],env=missing,capture_output=True,text=True)
 assert refused_escape.returncode!=0 and 'reset rollback release required' in refused_escape.stderr and (root/'current').readlink().as_posix()=='releases/'+oldid
 old_manifest=Path(tmp)/'old.json';old_manifest.write_text(json.dumps({'index.html':release.digest(b'old')}))
 optimized={**env,'PYTHONOPTIMIZE':'1','HAIRPLAY_CACHE_RESET_RELEASE_ID':oldid,
            'HAIRPLAY_CACHE_RESET_MANIFEST':str(old_manifest),'HAIRPLAY_CACHE_RESET_SHA256':'0'*64}
 attack=subprocess.run(['bash',str(runner),'deploy',newid,str(manifest),str(checker),str(archive)],env=optimized,capture_output=True,text=True)
 assert attack.returncode!=0 and 'Reset worker SHA-256 mismatch' in attack.stderr and (root/'current').readlink().as_posix()=='releases/'+oldid
 result=subprocess.run(['bash',str(runner),'deploy',newid,str(manifest),str(checker),str(archive)],env=env,capture_output=True,text=True)
 assert result.returncode!=0,(result.stdout,result.stderr)
 assert 'Restoring releases/'+resetid in result.stderr,(result.stdout,result.stderr)
 assert (root/'current').readlink().as_posix()=='releases/'+resetid
 assert (reset/'hairplay-images-sw.js').read_bytes()==reset_worker.read_bytes()
 # A staged release may also be activated via switch, not only deploy.
 (root/'current').unlink();(root/'current').symlink_to('releases/'+oldid)
 refused=subprocess.run(['bash',str(runner),'switch',newid,str(manifest),str(checker)],env=missing,capture_output=True,text=True)
 assert refused.returncode!=0 and (root/'current').readlink().as_posix()=='releases/'+oldid
 switched=subprocess.run(['bash',str(runner),'switch',newid,str(manifest),str(checker)],env=env,capture_output=True,text=True)
 assert switched.returncode!=0,(switched.stdout,switched.stderr)
 assert 'Restoring releases/'+resetid in switched.stderr,(switched.stdout,switched.stderr)
 assert (root/'current').readlink().as_posix()=='releases/'+resetid
 # From an installed SW, neither deploy nor switch may publish a worker-less tree.
 noid='20260104T000000Z';noarchive=Path(tmp)/'no-worker.tgz';nomanifest=Path(tmp)/'no-worker.json'
 with tarfile.open(noarchive,'w:gz',format=tarfile.USTAR_FORMAT) as tar:
  body=b'old';entry=tarfile.TarInfo('index.html');entry.size=len(body);tar.addfile(entry,io.BytesIO(body))
 nomanifest.write_text(json.dumps({'index.html':release.digest(b'old')}))
 for mode,target,manifest_path,extra in [('deploy',noid,nomanifest,[str(noarchive)]),('switch',oldid,nomanifest,[])]:
  attempt=subprocess.run(['bash',str(runner),mode,target,str(manifest_path),str(checker),*extra],env=env,capture_output=True,text=True)
  assert attempt.returncode!=0 and 'worker-less release is unsafe' in attempt.stderr,(mode,attempt.stdout,attempt.stderr)
  assert (root/'current').readlink().as_posix()=='releases/'+resetid
 print('FORCED_HTTP_FAILURE_ROLLBACK_OK: real archive/tree verifier, forced HTTP failure; deploy/switch use reset clone; escaped JSON, optimized Python bypass and worker-less downgrade blocked')
