import {test} from 'node:test';
import {fork} from 'node:child_process';
import {randomInt} from 'node:crypto';
import assert from 'node:assert/strict';
import {statSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {AuthStore,normalizeEmail} from './auth.mjs';
import {fixture,login} from './test-support.mjs';
test('codes: cooldown, resend, expiry, attempt budget, one-use, normalization',t=>{
 const {store:s,advance}=fixture(t);const email=normalizeEmail(' TEST@Example.invalid ');assert.equal(email,'test@example.invalid');
 const c=s.issue(email,'a');assert.throws(()=>s.issue(email,'a'),{status:429});
 for(let i=0;i<5;i++)assert.equal(s.verify(email,'not-code'),null);assert.equal(s.verify(email,c),null);
 advance(60000);const c2=s.issue(email,'a');assert.equal(s.verify(email,c),null);const token=s.verify(email,c2);assert.ok(token);assert.equal(s.verify(email,c2),null);
 advance(60000);const c3=s.issue(email,'a');advance(600000);assert.equal(s.verify(email,c3),null);
 assert.equal(s.session(token).email,email);advance(7*86400000);assert.equal(s.session(token),null);
});
test('email + IP + global mail limits are persistent and independent of account existence',t=>{
 const {store:s,path,advance,now}=fixture(t);
 for(let i=0;i<5;i++){s.issue('same@example.invalid','ip-'+i);advance(60001);}
 assert.throws(()=>s.issue('same@example.invalid','new'),{status:429});
 for(let i=0;i<5;i++){s.issue('a'+i+'@example.invalid','other');advance(60001);}
 assert.throws(()=>s.issue('new@example.invalid','other'),{status:429});
 const second=new AuthStore(path,{now});t.after(()=>second.close());assert.throws(()=>second.issue('same@example.invalid','fresh'),{status:429});
});
test('legacy accounts migrate with unknown gender; new gender is optional, editable and never overwritten on login',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hairplay-gender-migrate-')),path=join(dir,'auth.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const legacy=new DatabaseSync(path);legacy.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE); INSERT INTO users(email) VALUES('old@example.invalid')");legacy.close();
 let now=Date.now();const store=new AuthStore(path,{now:()=>now});t.after(()=>store.close());
 const old=store.db.prepare('SELECT * FROM users WHERE email=?').get('old@example.invalid');assert.equal(old.id,1);assert.equal(old.gender,null);
 const code=store.issue('new@example.invalid','new');const token=store.verify('new@example.invalid',code,'male');assert.equal(store.session(token).gender,'male');
 store.setGender(store.session(token).id,null);assert.equal(store.session(token).gender,null);
 store.setGender(store.session(token).id,'female');assert.equal(store.session(token).gender,'female');
 assert.throws(()=>store.setGender(store.session(token).id,'other'),{status:400});
 const oldCode=store.issue('old@example.invalid','old');const oldToken=store.verify('old@example.invalid',oldCode,'male');assert.equal(store.session(oldToken).gender,null);
 store.setGender(store.session(oldToken).id,'male');now+=61000;
 const next=store.issue('old@example.invalid','another');assert.equal(store.session(store.verify('old@example.invalid',next,'female')).gender,'male');
 const reopened=new AuthStore(path,{now:()=>now});assert.equal(reopened.session(token).gender,'female');assert.equal(reopened.session(oldToken).gender,'male');reopened.close();
});
test('concurrent startup of legacy database serializes gender migration',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'hairplay-gender-race-')),path=join(dir,'auth.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const legacy=new DatabaseSync(path);legacy.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE); INSERT INTO users(email) VALUES('old@example.invalid')");legacy.close();
 const results=await Promise.all(Array.from({length:8},()=>new Promise((resolve,reject)=>{
  const child=fork(new URL('./auth-worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc']});
  child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code!==0)reject(Error('Concurrent migration failed '+code));});
  child.send({path,time:Date.now(),entries:[]});
 })));
 assert.deepEqual(results,Array(8).fill(0));const store=new AuthStore(path);assert.equal(store.db.prepare('SELECT gender FROM users WHERE email=?').get('old@example.invalid').gender,null);store.close();
});
test('atomic cap of 100 verified accounts across connections; existing account can log in',async t=>{
 const {store:s,path,now,advance}=fixture(t);const second=new AuthStore(path,{now});t.after(()=>second.close());
 const tasks=Array.from({length:100},(_,i)=>Promise.resolve().then(()=>{const db=i%2?s:second;const c=db.issue(`user${i}@example.invalid`,'ip'+i);return db.verify(`user${i}@example.invalid`,c);}));
 // Global hourly mail budget also caps 100 requests; advance a window for the 101st.
 const results=await Promise.all(tasks);assert.equal(results.filter(Boolean).length,100);advance(3600001);
 const c=s.issue('overflow@example.invalid','overflow');assert.ok(typeof c==='string');assert.ok(s.verify('overflow@example.invalid',c)===null);
 const known=s.issue('user0@example.invalid','known');assert.match(known,/^\d{6}$/);
 const token=s.verify('user0@example.invalid',known);assert.ok(token);assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,100);
 s.logout(token);assert.equal(s.session(token),null);
});
test('120 simultaneous verification candidates across 8 workers cannot exceed 100 accounts',async t=>{
 const {store:s,path,now}=fixture(t);const batches=Array.from({length:8},()=>[]);
 // Pre-issued fake challenges isolate the registration transaction from the mail budget.
 for(let i=0;i<120;i++){const email=`parallel${i}@example.invalid`,code=String(randomInt(0,1000000)).padStart(6,'0');s.db.prepare('INSERT INTO codes VALUES(?,?,?,0)').run(email,s.hash(email+':'+code),now()+600000);batches[i%8].push([email,code]);}
 const counts=await Promise.all(batches.map(entries=>new Promise((resolve,reject)=>{const child=fork(new URL('./auth-worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code!==0)reject(Error('Registration process exited '+code));});child.send({path,time:now(),entries});})));assert.equal(counts.reduce((a,b)=>a+b,0),100);assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,100);
});
test('persistent atomic reservations, failure release, idempotent success and bounded recovery',t=>{
 const {store:s,path,now,advance}=fixture(t);const token=login(s);const user=s.session(token).id;
 const second=new AuthStore(path,{now});t.after(()=>second.close());
 let id=s.reserve(user);assert.throws(()=>second.reserve(user),{status:429});s.finish(id,false);assert.equal(s.remaining(user),3);
 advance(3600001);
 for(let i=0;i<3;i++){id=s.reserve(user);s.finish(id,true);s.finish(id,true);assert.equal(second.remaining(user),2-i);advance(3600001);}
 assert.equal(s.reserve(user),null);assert.equal(second.remaining(user),0);assert.equal(statSync(path).mode&0o777,0o600);
 const u2=s.session(login(s,'fresh@example.invalid','fresh')).id;id=s.reserve(u2);assert.equal(second.remaining(u2),2);advance(600001);assert.equal(second.remaining(u2),3);
 s.close();const reopened=new AuthStore(path,{now});assert.equal(reopened.remaining(user),0);assert.ok(reopened.session(token));reopened.close();
});
