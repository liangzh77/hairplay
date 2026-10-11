import sys,pathlib,tempfile,subprocess,sqlite3,threading,http.server,os,signal,time,hashlib
# Linux /tmp only; fake service and temporary SQLite, never a production publish.
B=pathlib.Path(tempfile.gettempdir()); S=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(S));import release;import test_api_remote_publish as helper
failures=[]
for sig,group in [(signal.SIGTERM,False),(signal.SIGTERM,True),(signal.SIGHUP,True),(signal.SIGINT,True)]:
 with tempfile.TemporaryDirectory(dir=B,prefix='full-signal-') as temp:
  t=pathlib.Path(temp);root=t/'root';data=t/'data';secrets=t/'secrets';temps=t/'temps';health=t/'health'
  for p in [root/'releases',data,secrets,temps]:p.mkdir(parents=True)
  with sqlite3.connect(data/'auth.sqlite') as db:db.execute('CREATE TABLE users(id)');db.executemany('INSERT INTO users VALUES(?)',[(1,),(2,)])
  old='20260101T000000Z';new='20270101T000000Z'
  helper.api_tree(root/'releases'/old);(root/'releases'/old/'node_modules').mkdir();(root/'current').symlink_to('releases/'+old)
  tree=helper.api_tree(t/'tree');release.pack_api(tree,t/'api.tgz',t/'manifest.json')
  restart=t/'restart.sh';restart.write_text('set -eu\nif [ "$(readlink "$HAIRPLAY_API_ROOT/current")" = "releases/'+old+'" ]; then printf \'%s\' \'{"account":null}\'; else printf \'%s\\0\' \'{"account":null}\'; fi > "$SIGNAL_HEALTH"\n')
  health.write_bytes(b'{"account":null}')
  class Handler(http.server.BaseHTTPRequestHandler):
   def do_GET(self):
    body=health.read_bytes();self.send_response(200);self.end_headers();self.wfile.write(body)
   def log_message(self,*args):pass
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
  env={**os.environ,'TMPDIR':str(temps),'HAIRPLAY_API_ROOT':str(root),'HAIRPLAY_API_DATA':str(data),'HAIRPLAY_API_SECRETS':str(secrets),'HAIRPLAY_API_RESTART':'bash '+str(restart),'HAIRPLAY_API_HEALTH':f'http://127.0.0.1:{server.server_address[1]}/session','SIGNAL_HEALTH':str(health)}
  # A detached/nohup driver may inherit ignored HUP/INT. Reset those in the
  # child before bash starts, so this tests delivered signals, not ignored ones.
  process=subprocess.Popen(['env','--default-signal=HUP,INT,TERM','bash',str(S/'release-api-remote.sh'),'deploy',new,str(t/'manifest.json'),str(S/'release.py'),str(t/'api.tgz')],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
  try:
   for _ in range(500):
    if os.readlink(root/'current')=='releases/'+new and any(p.is_file() and p.stat().st_size==17 for p in temps.iterdir()):break
    if process.poll() is not None:raise AssertionError(process.communicate())
    time.sleep(.02)
   else:raise AssertionError('never switched and tested unhealthy body')
   time.sleep(.15)
   (os.killpg if group else os.kill)(process.pid,sig);out,err=process.communicate(timeout=12)
   target=os.readlink(root/'current');left=list(temps.iterdir());rolled=target=='releases/'+old and 'API_PUBLISH_ROLLED_BACK' in err
   label=sig.name+(' group' if group else ' pid')
   print(f'OBSERVE {label} rc={process.returncode} current={target} rollback={rolled} health_temp_files={len(left)} failed_release_preserved={(root/"releases"/new).is_dir()}',flush=True)
   print('STDOUT '+out+'STDERR '+err,flush=True)
   assert process.returncode!=0 and not left and (root/'releases'/new).is_dir()
   print(('PASS ' if rolled else 'FAIL ') + label, flush=True)
   if not rolled:failures.append(label)
  finally:
   if process.poll() is None:os.killpg(process.pid,signal.SIGKILL);process.wait()
   server.shutdown();server.server_close()
print('SIGNAL_REHEARSAL failures='+repr(failures));sys.exit(bool(failures))
