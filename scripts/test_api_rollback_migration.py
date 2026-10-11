#!/usr/bin/env python3
"""Real AuthStore migration + complete publisher forced rollback, Linux /tmp only.
Historical fixture is byte-identical to 2f9a748:server/auth.mjs. No production IO.
Override HAIRPLAY_TEST_AUTH/HAIRPLAY_TEST_OLD_AUTH only for isolated negatives/git experiments.
"""
import pathlib, tempfile, subprocess, os, threading, http.server, json, sqlite3
import release
import test_api_remote_publish as helper
S = pathlib.Path(__file__).resolve().parent
AUTH = pathlib.Path(os.environ.get('HAIRPLAY_TEST_AUTH', S.parent / 'server/auth.mjs')).resolve()
OLD = pathlib.Path(os.environ.get('HAIRPLAY_TEST_OLD_AUTH', S / 'fixtures/rollback-auth-2f9a748.mjs')).resolve()
with tempfile.TemporaryDirectory(prefix='hairplay-real-rollback-', dir='/tmp') as temp:
 t=pathlib.Path(temp);root=t/'root';data=t/'data';secrets=t/'secrets';health=t/'health';result=t/'login-result.json'
 for p in [root/'releases',data,secrets,t/'temps']:p.mkdir(parents=True)
 old='20260101T000000Z';new='20270101T000000Z'
 oldtree=helper.api_tree(root/'releases'/old);(oldtree/'server/auth.mjs').write_bytes(OLD.read_bytes());(oldtree/'node_modules').mkdir();(root/'current').symlink_to('releases/'+old)
 tree=helper.api_tree(t/'tree');(tree/'server/auth.mjs').write_bytes(AUTH.read_bytes());release.pack_api(tree,t/'api.tgz',t/'manifest.json')
 init=f"import {{AuthStore}} from '{(oldtree/'server/auth.mjs').as_uri()}';const s=new AuthStore({json.dumps(str(data/'auth.sqlite'))});const t=s.verify('rollback@example.invalid',s.issue('rollback@example.invalid','fake-init'));if(!t)throw Error('baseline login failed');s.close();"
 subprocess.run(['node','--input-type=module','-e',init],check=True)
 restart=t/'restart.mjs'
 restart.write_text("import {readlinkSync,writeFileSync} from 'node:fs';\n"+f"""
 const root={json.dumps(str(root))},db={json.dumps(str(data/'auth.sqlite'))};
 const target=readlinkSync(root+'/current');const {{AuthStore}}=await import('file://'+root+'/'+target+'/server/auth.mjs');
 const s=new AuthStore(db);let login=true,error='';
 if(target==='releases/{old}'){{
  s.db.prepare('DELETE FROM sends').run();const code=s.issue('rollback@example.invalid','fake-rollback');
  try{{const token=s.verify('rollback@example.invalid',code);login=!!token;if(!login)throw Error('correct code rejected');const u=s.session(token);s.setFavorites(u.id,['dracula']);s.addImage(u.id,{{name:'old-write'}},Buffer.alloc(1024,2));s.logout(token);if(s.session(token))throw Error('logout failed');s.db.prepare('DELETE FROM sends').run();if(!s.verify('rollback@example.invalid',s.issue('rollback@example.invalid','fake-relogin')))throw Error('relogin failed');}}catch(e){{login=false;error=e.message}}
  writeFileSync({json.dumps(str(result))},JSON.stringify({{login,error}}));
 }}else{{s.setFavorites(1,['new-write-before-health-failure']);s.addImage(1,{{name:'new-write'}},Buffer.alloc(1024,1));}}
 s.close();writeFileSync({json.dumps(str(health))},target==='releases/{old}'?'{{"account":null}}':'UNHEALTHY_AFTER_REAL_MIGRATION');
 """)
 health.write_bytes(b'{"account":null}')
 class Handler(http.server.BaseHTTPRequestHandler):
  def do_GET(self):
   body=health.read_bytes();self.send_response(200);self.end_headers();self.wfile.write(body)
  def log_message(self,*args):pass
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 env={**os.environ,'TMPDIR':str(t/'temps'),'HAIRPLAY_API_ROOT':str(root),'HAIRPLAY_API_DATA':str(data),'HAIRPLAY_API_SECRETS':str(secrets),'HAIRPLAY_API_RESTART':'node '+str(restart),'HAIRPLAY_API_HEALTH':f'http://127.0.0.1:{server.server_address[1]}/session'}
 try:
  p=subprocess.run(['bash',str(S/'release-api-remote.sh'),'deploy',new,str(t/'manifest.json'),str(S/'release.py'),str(t/'api.tgz')],env=env,capture_output=True,text=True,timeout=90)
  print('STDOUT\n'+p.stdout+'STDERR\n'+p.stderr)
  with sqlite3.connect(data/'auth.sqlite') as db:
   columns=[r[1] for r in db.execute('pragma table_info(sessions)')];users=db.execute('select count(*) from users').fetchone()[0]
   revision=db.execute('select favorites from resource_revisions where user=1').fetchone()[0]
  with sqlite3.connect(data/'backups'/('auth-before-api-'+new+'.sqlite')) as db:
   backup_columns=[r[1] for r in db.execute('pragma table_info(sessions)')];backup_favorites=db.execute('select count(*) from favorites').fetchone()[0]
  obs={'publishRC':p.returncode,'current':os.readlink(root/'current'),'reportsRollback':'API_PUBLISH_ROLLED_BACK' in p.stderr,'healthBody':health.read_text(),'users':users,'liveSessionColumns':columns,'backupSessionColumns':backup_columns,'revision':revision,'backupFavorites':backup_favorites,**json.loads(result.read_text())}
  print('FULL_PUBLISHER_MIGRATION_ROLLBACK '+json.dumps(obs),flush=True)
  assert p.returncode!=0 and obs['reportsRollback'] and obs['current']=='releases/'+old and obs['healthBody']=='{"account":null}'
  assert obs['login'], obs['error']
  assert columns==['hash','user','expires'] and len(backup_columns)==3 and users==1
  assert revision==2 and backup_favorites==0 # new write survived rollback; old write advanced version
  upgrade=f"import {{AuthStore}} from '{AUTH.as_uri()}';const s=new AuthStore({json.dumps(str(data/'auth.sqlite'))});if(s.favoritesSnapshot(1).revision!==2||s.favorites(1)[0]!=='dracula'||s.remaining(1)!==3||s.gallerySnapshot(1).revision!==2||s.countImages(1)!==2||!s.listImages(1).some(x=>x.name==='new-write'&&Buffer.from(s.image(1,x.id).bytes).equals(Buffer.alloc(1024,1))))throw Error('reupgrade lost data');s.close();console.log('REUPGRADE_OK');"
  subprocess.run(['node','--input-type=module','-e',upgrade],check=True)
  print('REAL_ROLLBACK_OK correct-code login/logout/relogin/writes/reupgrade; backup not restored',flush=True)
 finally:server.shutdown();server.server_close()
