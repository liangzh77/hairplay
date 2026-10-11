import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createApp} from './ark.mjs';
import {AuthStore} from './auth.mjs';
import {fixture,login,start} from './test-support.mjs';
const picture=await readFile(new URL('../client/src/static/catalog/ai-catalog-53-0.jpg',import.meta.url));
const config={key:'fake-only',model:'doubao-seedream-4-5-251128',endpoint:'https://ark.cn-beijing.volces.com/api/v3'};
const origin='http://127.0.0.1:8767';

test('persistent revisions: initialization, noops, conflict, ABA contents and gallery transaction snapshots',t=>{
 const {store}=fixture(t),token=login(store),u=store.session(token);
 assert.deepEqual(store.favoritesSnapshot(u.id),{ids:[],initialized:false,revision:0});
 assert.equal(store.gallerySnapshot(u.id).revision,0);
 assert.equal(store.removeFavorite(u.id,'dracula').revision,1); // first empty initialization
 assert.equal(store.removeFavorite(u.id,'dracula').revision,1);
 assert.equal(store.adoptFavorites(u.id,['dracula']).revision,1);
 assert.equal(store.adoptFavorites(u.id,['dracula']).conflict,true);
 assert.equal(store.addFavorite(u.id,'dracula').revision,2);
 assert.equal(store.addFavorite(u.id,'dracula').revision,2);
 const removed=store.removeFavorite(u.id,'dracula');
 assert.deepEqual(removed,{ids:[],initialized:true,revision:3}); // same contents as rev1, newer fact
 const added=store.addImage(u.id,{name:'fake-only'},picture);
 assert.equal(added.revision,1);assert.deepEqual(added.images.map(r=>r.id),[added.id]);
 const retry=store.addImage(u.id,{name:'retry'},picture);
 assert.equal(retry.id,added.id);assert.equal(retry.revision,1);
 assert.equal(store.deleteImageSnapshot(u.id,'f'.repeat(24)).revision,1);
 const deleted=store.deleteImageSnapshot(u.id,added.id);
 assert.deepEqual(deleted,{deleted:true,images:[],revision:2});
 assert.equal(store.deleteImageSnapshot(u.id,added.id).revision,2);
 const job=store.reserve(u.id),generated=store.finishWithImage(job,{name:'fake-only'},picture);
 assert.equal(generated.revision,3);assert.equal(store.remaining(u.id),2);
 store.db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON gallery BEGIN SELECT RAISE(ABORT,'fake-only'); END;");
 const job2=store.reserve(u.id);
 assert.throws(()=>store.finishWithImage(job2,{name:'fail'},Buffer.concat([picture,Buffer.from([0])])));
 assert.equal(store.gallerySnapshot(u.id).revision,3);store.finish(job2,false);
 assert.equal(store.remaining(u.id),2);
});

test('context identifies a session, not an account; bound requests reject before body and stale logout leaves new session',async t=>{
 const {store,advance}=fixture(t);let upstream=0,reservations=0;
 const reserve=store.reserve.bind(store);store.reserve=(...args)=>{reservations++;return reserve(...args);};
 const a=login(store,'same@example.invalid','first'),old=store.session(a);
 advance(60001);const b=login(store,'same@example.invalid','second'),current=store.session(b);
 assert.equal(old.id,current.id);assert.notEqual(old.context,current.context);
 assert.match(current.context,/^[0-9a-f]{32}$/);assert.equal(store.session(current.context),null);
 const server=createApp({config,auth:store,mailer:{send:async()=>{throw Error('SMTP forbidden');}},fetchImpl:async()=>{upstream++;throw Error('upstream forbidden');}});
 t.after(()=>server.close());const base=await start(server);
 const cookie='hairplay='+b;
 for(const path of ['generate','gallery/import','favorites','auth/gender','gallery/delete','auth/logout']){
  const response=await new Promise((resolve,reject)=>{
   const req=request(base+'/api/'+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie,'x-hairplay-context':old.context,'content-length':'100000'}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>{req.destroy();resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(body)});});});
   req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('server waited for body')));req.flushHeaders(); // no photo/body ever sent
  });
  assert.equal(response.status,409,path);assert.equal(response.body.code,'CONTEXT_MISMATCH');assert.equal(response.headers['set-cookie'],undefined);
 }
 assert.equal(upstream,0);assert.equal(reservations,0);assert.equal(store.remaining(current.id),3);
 assert.ok(store.session(b));assert.ok(store.session(a));
 for(const path of ['generate','gallery/import','auth/logout']){
  const r=await fetch(base+'/api/'+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:'{}'});
  assert.equal(r.status,428);assert.equal((await r.json()).code,'CONTEXT_REQUIRED');
 }
 const get=await fetch(base+'/api/favorites',{headers:{cookie,'x-hairplay-context':current.context}}).then(r=>r.json());
 assert.deepEqual(get,{owner:current.email,context:current.context,ids:[],initialized:false,revision:0});
 const edit=await fetch(base+'/api/favorites',{method:'POST',headers:{origin,'content-type':'application/json',cookie,'x-hairplay-context':current.context},body:JSON.stringify({add:'dracula'})}).then(r=>r.json());
 assert.equal(edit.revision,1);assert.equal(edit.context,current.context);assert.deepEqual(edit.ids,['dracula']);
 // Temporary old UI compatibility is explicitly weaker, not a bound operation.
 const legacy=await fetch(base+'/api/favorites',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify({remove:'dracula'})});assert.equal(legacy.status,200);
 const out=await fetch(base+'/api/auth/logout',{method:'POST',headers:{origin,'content-type':'application/json',cookie,'x-hairplay-context':current.context},body:'{}'});
 assert.equal(out.status,200);assert.equal(store.session(b),null);assert.ok(store.session(a));
});

test('legacy session/gallery/favorites migration retains data and stable public context across reopen',t=>{
 const {store,path}=fixture(t),token=login(store),user=store.session(token);
 store.setFavorites(user.id,['dracula']);const saved=store.addImage(user.id,{name:'legacy'},picture);
 // Reconstruct the actual predecessor columns, not only an empty mock database.
 store.db.exec('DROP TABLE resource_revisions; ALTER TABLE sessions DROP COLUMN context;');
 const upgraded=new AuthStore(path);t.after(()=>upgraded.close());
 const next=upgraded.session(token);assert.equal(next.id,user.id);assert.match(next.context,/^[0-9a-f]{32}$/);
 assert.equal(upgraded.favoritesSnapshot(user.id).revision,1);assert.equal(upgraded.gallerySnapshot(user.id).revision,1);
 assert.equal(upgraded.listImages(user.id)[0].id,saved.id);assert.ok(Buffer.from(upgraded.image(user.id,saved.id).bytes).equals(picture));
 const reopened=new AuthStore(path);t.after(()=>reopened.close());assert.equal(reopened.session(token).context,next.context);
 assert.equal(reopened.addImage(user.id,{name:'retry'},picture).revision,1);
});
