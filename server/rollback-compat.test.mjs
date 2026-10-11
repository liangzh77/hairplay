// Embedded legacy SQL contracts: runs in a clean archive, no /tmp/git dependency.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHmac} from 'node:crypto';
import {AuthStore} from './auth.mjs';
import {spawn} from 'node:child_process';
const picture=readFileSync(new URL('../client/src/static/catalog/ai-catalog-53-0.jpg',import.meta.url));
for(const intermediate of [false,true])test(`real positional legacy session roundtrip; four-column intermediate=${intermediate}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hairplay-rollback-')),path=join(dir,'auth.sqlite');let store,old;
 try{
  old=new DatabaseSync(path);
  old.exec(`CREATE TABLE sessions(hash TEXT PRIMARY KEY,user INTEGER NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE);
   INSERT INTO users VALUES(1,'rollback@example.invalid');
   CREATE TABLE meta(k TEXT PRIMARY KEY,v TEXT NOT NULL); INSERT INTO meta VALUES('pepper','fake-only');`);
  const hash=t=>createHmac('sha256','fake-only').update(t).digest('hex');
  const token=randomBytes(32).toString('base64url');old.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),1,Date.now()+86400000);
  if(intermediate){old.exec('ALTER TABLE sessions ADD COLUMN context TEXT');old.prepare('UPDATE sessions SET context=?').run('a'.repeat(32));}
  old.close();old=null;
  const code=`import {AuthStore} from ${JSON.stringify(new URL('./auth.mjs',import.meta.url).href)};const s=new AuthStore(${JSON.stringify(path)});console.log(s.session(${JSON.stringify(token)}).context);s.close();`;
  const contexts=await Promise.all(Array.from({length:6},()=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--input-type=module','-e',code]);let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',rc=>rc===0?resolve(out.trim()):reject(Error(err)));
  })));
  assert.equal(new Set(contexts).size,1);store=new AuthStore(path);
  const context=store.session(token).context;assert.equal(context,contexts[0]);if(intermediate)assert.equal(context,'a'.repeat(32));
  assert.equal(store.session(context),null);
  store.setFavorites(1,['dracula']);const image=store.addImage(1,{name:'preserve'},picture);
  const before={favorites:store.revision(1,'favorites'),gallery:store.revision(1,'gallery')};
  store.close();store=null;old=new DatabaseSync(path);
  // Exact historical positional write, then logout and another correct session.
  const rolled=randomBytes(32).toString('base64url');
  old.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(rolled),1,Date.now()+86400000);
  old.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
  assert.equal(old.prepare('SELECT count(*) n FROM session_contexts WHERE hash=?').get(hash(token)).n,0);
  old.prepare('INSERT INTO favorites VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET ids=excluded.ids,updated=excluded.updated').run(1,'[]',Date.now());
  old.prepare('INSERT INTO favorites VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET ids=excluded.ids,updated=excluded.updated').run(1,'["dracula"]',Date.now()); // ABA
  old.prepare('DELETE FROM gallery WHERE id=? AND user=?').run(image.id,1);
  old.close();old=null;store=new AuthStore(path);
  assert.equal(store.session(token),null);const next=store.session(rolled);assert.notEqual(next.context,context);
  assert.equal(store.revision(1,'favorites'),before.favorites+2);assert.equal(store.revision(1,'gallery'),before.gallery+1);
  assert.deepEqual(store.favorites(1),['dracula']);assert.equal(store.countImages(1),0);assert.equal(store.remaining(1),3);
  assert.equal(store.db.prepare('SELECT count(*) n FROM users').get().n,1);
  // Legacy process can insert while new service stays open: lazy context once.
  old=new DatabaseSync(path);const concurrent=randomBytes(32).toString('base64url');old.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(concurrent),1,Date.now()+86400000);
  const lazy=store.session(concurrent).context;assert.notEqual(lazy,next.context);assert.equal(store.session(concurrent).context,lazy);
  old.prepare('DELETE FROM sessions WHERE hash=?').run(hash(concurrent));assert.equal(store.session(concurrent),null);
  const expired=randomBytes(32).toString('base64url');old.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(expired),1,1);old.prepare('INSERT INTO session_contexts VALUES(?,?)').run(hash(expired),'b'.repeat(32));assert.equal(store.session(expired),null);
  const fresh=store.verify('rollback@example.invalid',store.issue('rollback@example.invalid','fake'));
  assert.ok(fresh);assert.equal(store.db.prepare('SELECT count(*) n FROM session_contexts WHERE hash=?').get(hash(expired)).n,0);
  old.prepare('INSERT INTO users(email) VALUES(?)').run('new-legacy@example.invalid');
  old.prepare('INSERT INTO favorites VALUES(?,?,?)').run(2,'[]',1);assert.equal(store.favoritesSnapshot(2).revision,1);
  old.prepare('INSERT INTO gallery VALUES(?,?,?,?,?,?,?,?)').run('legacy-new',2,'preserved',null,1,picture.length,picture,'fake-hash');assert.equal(store.gallerySnapshot(2).revision,1);
  store.db.exec("CREATE TRIGGER fail_revision BEFORE UPDATE OF gallery ON resource_revisions BEGIN SELECT RAISE(ABORT,'revision failure'); END;");
  assert.throws(()=>old.prepare('DELETE FROM gallery WHERE id=?').run('legacy-new'),/revision failure/);assert.equal(store.gallerySnapshot(2).revision,1);assert.ok(store.image(2,'legacy-new'));store.db.exec('DROP TRIGGER fail_revision');
  const stable=store.session(rolled).context;store.close();store=new AuthStore(path);assert.equal(store.session(rolled).context,stable);
 }finally{old?.close();store?.close();rmSync(dir,{recursive:true,force:true});}
});
