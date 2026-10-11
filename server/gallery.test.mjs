import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApp} from './ark.mjs';
import {GALLERY_LIMIT,FAVORITE_LIMIT} from './auth.mjs';
import {fixture,login,start} from './test-support.mjs';
const load=file=>readFile(new URL('../client/src/static/catalog/'+file,import.meta.url));
const picture=await load('ai-catalog-53-0.jpg');
// Distinct real JPEGs: the album keys on the content hash, so every "another
// picture" case needs different bytes that still decode.
const others=await Promise.all(['ai-catalog-44-0.jpg','catalog-44-0.jpg','ai-dracula.jpg'].map(load));
const pics=[picture,...others];
const dataOf=bytes=>'data:image/jpeg;base64,'+bytes.toString('base64');
const data=dataOf(picture);
const origin='http://127.0.0.1:8767';
const config={key:'test-only-secret',model:'doubao-seedream-4-5-251128',endpoint:'https://ark.cn-beijing.volces.com/api/v3'};
const upstream=async()=>new Response(JSON.stringify({data:[{b64_json:picture.toString('base64')}]}));
const STRUCTURE='只能上传 4 MB 以内、结构完整的 JPEG 图片';
// A JPEG header and an EOI marker with garbage in between is structurally a JPEG
// but cannot be decoded: sharp is the authoritative gate.
const undecodable='data:image/jpeg;base64,'+Buffer.concat([picture.subarray(0,1024),Buffer.alloc(2000),Buffer.from([0xff,0xd9])]).toString('base64');
function app(t,{fetchImpl=upstream}={}){
 const {store}=fixture(t);
 const server=createApp({config,auth:store,mailer:{send:async()=>{}},fetchImpl});
 t.after(()=>server.close());
 return {store,server};
}
const cookieFor=(store,email,ip)=>'hairplay='+login(store,email,ip);
const userOf=(store,cookie)=>store.session(cookie.slice('hairplay='.length));
const post=(base,path,body,cookie,headers={})=>fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{}),...headers},body:JSON.stringify(body)});

test('store keeps cloud pictures per account, caps the album and dedupes identical bytes',t=>{
 const {store}=fixture(t);
 const a=userOf(store,cookieFor(store,'a@example.invalid','a'));
 const b=userOf(store,cookieFor(store,'b@example.invalid','b'));
 const one=store.addImage(a.id,{name:'第一张',style:'catalog-53-1'},pics[0]);
 const two=store.addImage(a.id,{name:'第二张',style:'../escape'},pics[1]);
 assert.equal(store.countImages(a.id),2);
 assert.deepEqual(store.listImages(a.id).map(r=>r.id),[two.id,one.id]);
 assert.equal(store.listImages(b.id).length,0);
 assert.equal(store.image(b.id,one.id),null);
 assert.equal(store.image(a.id,'0'.repeat(24)),null);
 assert.equal(store.image(a.id,one.id).name,'第一张');
 assert.equal(store.image(a.id,one.id).style,'catalog-53-1');
 assert.equal(store.image(a.id,two.id).style,null);
 assert.ok(Buffer.from(store.image(a.id,one.id).bytes).equals(pics[0]));
 // The same bytes are the same picture: a retry returns the existing row instead
 // of spending a second slot, and it keeps the name it was first stored with.
 assert.deepEqual(store.addImage(a.id,{name:'重试',style:'dracula'},pics[0]),{...one});
 assert.equal(store.countImages(a.id),2);
 assert.equal(store.image(a.id,one.id).name,'第一张');
 assert.equal(store.image(a.id,one.id).style,'catalog-53-1');
 store.addImage(a.id,{name:'第三张'},pics[2]);
 assert.throws(()=>store.addImage(a.id,{name:'第四张'},pics[3]),{status:429});
 assert.throws(()=>store.addImage(a.id,{name:'太大'},Buffer.alloc(5*1024*1024)),{status:400});
 assert.throws(()=>store.addImage(a.id,{name:'太小'},Buffer.alloc(10)),{status:400});
 assert.equal(store.countImages(a.id),GALLERY_LIMIT);
 // Dedupe is answered before the cap: re-importing a picture the account already
 // holds succeeds even when the album is full.
 assert.deepEqual(store.addImage(a.id,{name:'满时重试'},pics[0]),{...one});
 assert.equal(store.countImages(a.id),GALLERY_LIMIT);
 assert.equal(store.deleteImage(b.id,one.id),false);
 assert.equal(store.deleteImage(a.id,one.id),true);
 assert.equal(store.deleteImage(a.id,one.id),false);
 assert.equal(store.countImages(a.id),2);
});

test('a generation is either charged with its cloud copy or refunded, never charged without it',t=>{
 const {store}=fixture(t);
 const user=userOf(store,cookieFor(store,'charge@example.invalid','charge'));
 const job=store.reserve(user.id);
 assert.equal(store.remaining(user.id),2);
 assert.throws(()=>store.finishWithImage(job,{name:'无效'},Buffer.alloc(10)),{status:400});
 assert.equal(store.countImages(user.id),0);
 store.finish(job,false);
 assert.equal(store.remaining(user.id),3);
 const saved=store.finishWithImage(store.reserve(user.id),{name:'成功',style:'catalog-53-1'},picture);
 assert.match(saved.id,/^[0-9a-f]{24}$/);
 assert.equal(store.finishWithImage(job,{name:'重复'},picture),null);
 assert.equal(store.countImages(user.id),1);
 assert.equal(store.remaining(user.id),2);
 assert.equal(store.listImages(user.id)[0].name,'成功');
 // An import cannot push a generation over the cap either: the commit refuses it
 // and leaves the job pending, so the caller refunds the quota.
 const other=userOf(store,cookieFor(store,'charge2@example.invalid','charge2'));
 for(const bytes of pics.slice(0,GALLERY_LIMIT))store.addImage(other.id,{name:'导入'},bytes);
 const raced=store.reserve(other.id);
 assert.equal(store.remaining(other.id),2);
 assert.throws(()=>store.finishWithImage(raced,{name:'溢出'},pics[3]),{status:429});
 store.finish(raced,false);
 assert.equal(store.countImages(other.id),GALLERY_LIMIT);
 assert.equal(store.remaining(other.id),3);
});

test('store favourites: adoption once, atomic edits, unvalidated rows are filtered',t=>{
 const {store}=fixture(t);
 const user=userOf(store,cookieFor(store,'favstore@example.invalid','favstore'));
 assert.equal(store.favorites(user.id),null);
 assert.deepEqual(store.adoptFavorites(user.id,['catalog-53-1','dracula','catalog-53-1']),{ids:['catalog-53-1','dracula'],conflict:false});
 // Only the first snapshot is accepted; afterwards the server list is the truth,
 // so a stale snapshot cannot resurrect what another device removed.
 assert.deepEqual(store.adoptFavorites(user.id,['catalog-53-1']),{ids:['catalog-53-1','dracula'],conflict:true});
 assert.deepEqual(store.addFavorite(user.id,'catalog-44-0'),{ids:['catalog-44-0','catalog-53-1','dracula']});
 assert.deepEqual(store.addFavorite(user.id,'catalog-44-0'),{ids:['catalog-44-0','catalog-53-1','dracula']});
 assert.deepEqual(store.removeFavorite(user.id,'dracula'),{ids:['catalog-44-0','catalog-53-1']});
 assert.deepEqual(store.favorites(user.id),['catalog-44-0','catalog-53-1']);
 // A deliberately empty list is distinguishable from "never synced".
 store.setFavorites(user.id,[]);
 assert.deepEqual(store.favorites(user.id),[]);
 assert.deepEqual(store.adoptFavorites(user.id,['dracula']),{ids:[],conflict:true});
 store.db.prepare('UPDATE favorites SET ids=? WHERE user=?').run(JSON.stringify(['ok-id','../escape','带空格 id']),user.id);
 assert.deepEqual(store.favorites(user.id),['ok-id']);
 const full=Array.from({length:FAVORITE_LIMIT},(_,i)=>'f'+i);
 store.setFavorites(user.id,full);
 assert.throws(()=>store.addFavorite(user.id,'one-more'),{status:429});
 assert.deepEqual(store.favorites(user.id),full);
 assert.deepEqual(store.removeFavorite(user.id,'f0'),{ids:full.slice(1)});
});

test('cloud album HTTP: ownership, byte-exact download, idempotent delete and uncacheable images',async t=>{
 const {store,server}=app(t);const base=await start(server);
 const a=cookieFor(store,'a@example.invalid','a'),b=cookieFor(store,'b@example.invalid','b');
 const generated=await post(base,'/api/generate',{photo:data,styleId:'catalog-53-1'},a);
 assert.equal(generated.status,200);
 const body=await generated.json();
 assert.match(body.image,/^data:image\/jpeg;base64,/);
 assert.match(body.record.id,/^[0-9a-f]{24}$/);
 assert.ok(!JSON.stringify(body).includes(config.key));
 assert.equal(store.image(userOf(store,a).id,body.record.id).name,'庞巴杜发型');
 assert.deepEqual(await (await fetch(base+'/api/gallery',{headers:{cookie:a}})).json(),{images:[{id:body.record.id,name:'庞巴杜发型',style:'catalog-53-1',created:body.record.created,size:picture.length}]});
 assert.equal((await fetch(base+'/api/gallery')).status,401);
 assert.equal((await fetch(base+'/api/gallery/'+body.record.id)).status,401);
 assert.equal((await fetch(base+'/api/gallery/'+body.record.id,{headers:{cookie:b}})).status,404);
 assert.equal((await fetch(base+'/api/gallery/'+'A'.repeat(24),{headers:{cookie:a}})).status,404);
 assert.equal((await fetch(base+'/api/gallery/..%2f..%2fetc%2fpasswd',{headers:{cookie:a}})).status,404);
 const image=await fetch(base+'/api/gallery/'+body.record.id+'?v=1',{headers:{cookie:a}});
 assert.equal(image.status,200);
 assert.equal(image.headers.get('content-type'),'image/jpeg');
 // A private picture must not survive in any shared HTTP cache: after signing out
 // the same URL may not be served from the browser cache.
 assert.equal(image.headers.get('cache-control'),'private, no-store');
 assert.equal(image.headers.get('x-content-type-options'),'nosniff');
 assert.equal(image.headers.get('content-length'),String(picture.length));
 assert.ok(Buffer.from(await image.arrayBuffer()).equals(picture));
 assert.equal((await post(base,'/api/gallery/delete',{id:'nope'},a)).status,400);
 assert.equal((await post(base,'/api/gallery/delete',{id:'A'.repeat(24)},a)).status,400);
 assert.deepEqual(await (await post(base,'/api/gallery/delete',{id:body.record.id},b)).json(),{ok:true,deleted:false});
 assert.equal(store.countImages(userOf(store,a).id),1);
 assert.deepEqual(await (await post(base,'/api/gallery/delete',{id:body.record.id},a)).json(),{ok:true,deleted:true});
 assert.deepEqual(await (await post(base,'/api/gallery/delete',{id:body.record.id},a)).json(),{ok:true,deleted:false});
 assert.equal((await fetch(base+'/api/gallery/'+body.record.id,{headers:{cookie:a}})).status,404);
 assert.deepEqual(await (await fetch(base+'/api/gallery',{headers:{cookie:a}})).json(),{images:[]});
 assert.equal((await post(base,'/api/gallery/delete',{id:body.record.id},'')).status,401);
 assert.equal((await post(base,'/api/gallery/delete',{id:body.record.id},a,{origin:'https://evil.invalid'})).status,403);
 assert.equal((await post(base,'/api/gallery/delete',{id:body.record.id},a,{'content-type':'text/plain'})).status,403);
});

test('cloud album HTTP refuses to charge a generation whose cloud copy cannot be stored',async t=>{
 const {store,server}=app(t);const base=await start(server);
 const cookie=cookieFor(store,'store@example.invalid','store');
 // Full disk / locked database: the commit that stores the picture and consumes
 // the quota cannot happen, so the generation must not be charged either.
 store.finishWithImage=()=>{throw Error('disk full: private storage details');};
 const failed=await post(base,'/api/generate',{photo:data,styleId:'catalog-53-1'},cookie);
 assert.equal(failed.status,502);
 const failure=await failed.json();
 assert.equal(failure.error,'生成失败，请稍后重试；未扣成功额度');
 assert.ok(!JSON.stringify(failure).includes('private storage details'));
 assert.equal(store.countImages(userOf(store,cookie).id),0);
 assert.equal(store.remaining(userOf(store,cookie).id),3);
});

test('cloud album HTTP refuses a generation for a full album before paying for it',async t=>{
 let calls=0;
 // Every successful upstream call returns a different picture, so a "freed slot"
 // case cannot silently pass through the content-hash dedupe.
 const {store,server}=app(t,{fetchImpl:async()=>{const bytes=pics[calls];calls+=1;return new Response(JSON.stringify({data:[{b64_json:bytes.toString('base64')}]}));}});
 const base=await start(server);
 const cookie=cookieFor(store,'full@example.invalid','full'),user=userOf(store,cookie);
 for(const bytes of pics.slice(1,GALLERY_LIMIT+1))assert.equal((await post(base,'/api/gallery/import',{image:dataOf(bytes),name:'导入'},cookie)).status,200);
 const refused=await post(base,'/api/generate',{photo:data,styleId:'catalog-53-1'},cookie);
 assert.equal(refused.status,409);
 assert.equal((await refused.json()).error,'云端相册已满（最多 3 张），请先删除一张再生成；本次未扣额度');
 assert.equal(calls,0);
 assert.equal(store.remaining(user.id),3);
 assert.equal(store.countImages(user.id),GALLERY_LIMIT);
 // Deleting one frees a slot for a generation; the lifetime quota was never spent.
 await post(base,'/api/gallery/delete',{id:store.listImages(user.id)[0].id},cookie);
 const allowed=await post(base,'/api/generate',{photo:data,styleId:'catalog-53-1'},cookie);
 assert.equal(allowed.status,200);
 assert.equal(calls,1);
 assert.equal(store.countImages(user.id),GALLERY_LIMIT);
 assert.equal(store.remaining(user.id),2);
});

test('the album cap is enforced inside the generation commit as well as before it',async t=>{
 const {store,server}=app(t);const base=await start(server);
 const cookie=cookieFor(store,'backstop@example.invalid','backstop'),user=userOf(store,cookie);
 for(const bytes of pics.slice(1,GALLERY_LIMIT+1))assert.equal((await post(base,'/api/gallery/import',{image:dataOf(bytes),name:'导入'},cookie)).status,200);
 // Simulate an import landing between the route's pre-check and the commit: the
 // store still refuses, and the job is refunded instead of being charged.
 store.countImages=()=>0;
 const raced=await post(base,'/api/generate',{photo:data,styleId:'catalog-53-1'},cookie);
 assert.equal(raced.status,429);
 assert.equal((await raced.json()).error,'云端相册最多保存 3 张图片，请先删除一张再试；本次未扣成功额度');
 assert.equal(store.listImages(user.id).length,GALLERY_LIMIT);
 assert.equal(store.remaining(user.id),3);
});

test('import accepts only structurally complete JPEGs, dedupes retries and stops at the account cap',async t=>{
 const {store,server}=app(t);const base=await start(server);
 const cookie=cookieFor(store,'import@example.invalid','import'),user=userOf(store,cookie);
 const ok=await post(base,'/api/gallery/import',{image:dataOf(pics[0]),name:'本机旧记录',style:'catalog-53-1'},cookie);
 assert.equal(ok.status,200);
 const saved=await ok.json();
 assert.match(saved.id,/^[0-9a-f]{24}$/);
 assert.equal(saved.remaining,3);
 assert.equal(store.image(user.id,saved.id).name,'本机旧记录');
 assert.equal(store.image(user.id,saved.id).style,'catalog-53-1');
 // Retrying the same picture returns the same row: a client that lost the id (or
 // tapped "同步到云端" twice) does not fill the album with copies of it.
 const again=await post(base,'/api/gallery/import',{image:dataOf(pics[0]),name:'重试'},cookie);
 assert.equal(again.status,200);
 assert.equal((await again.json()).id,saved.id);
 assert.equal(store.countImages(user.id),1);
 assert.equal(store.image(user.id,saved.id).name,'本机旧记录');
 assert.equal((await post(base,'/api/gallery/import',{image:dataOf(pics[1]),name:'匿名风格',style:'../escape'},cookie)).status,200);
 assert.equal((await post(base,'/api/gallery/import',{image:dataOf(pics[2]),name:'第三张'},cookie)).status,200);
 assert.equal(store.countImages(user.id),3);
 assert.equal(store.listImages(user.id).find(r=>r.name==='匿名风格').style,null);
 const full=await post(base,'/api/gallery/import',{image:dataOf(pics[3]),name:'第四张'},cookie);
 assert.equal(full.status,429);
 assert.equal((await full.json()).error,'云端相册最多保存 3 张图片，请先删除一张再试');
 const bad=[
  ['data:image/png;base64,'+pics[0].toString('base64'),STRUCTURE],
  ['https://evil.invalid/a.jpg',STRUCTURE],
  ['data:image/jpeg;base64,AAAA',STRUCTURE],
  ['data:image/jpeg;base64,'+Buffer.concat([pics[0].subarray(0,pics[0].length-2),Buffer.from([0,0])]).toString('base64'),STRUCTURE],
  ['data:image/jpeg;base64,'+Buffer.concat([pics[0],Buffer.alloc(4.2*1024*1024)]).toString('base64'),STRUCTURE],
  ['data:image/jpeg;base64,'+Buffer.alloc(5*1024*1024).toString('base64'),STRUCTURE],
  [undecodable,'图片无法解码，已拒绝保存'],
 ];
 for(const [image,error] of bad)assert.deepEqual(await (await post(base,'/api/gallery/import',{image,name:'坏图'},cookie)).json(),{error});
 // A body larger than the route budget is refused before it is even parsed.
 const huge=await post(base,'/api/gallery/import',{image:'data:image/jpeg;base64,'+Buffer.alloc(8*1024*1024).toString('base64'),name:'过大'},cookie);
 assert.equal(huge.status,413);
 assert.equal((await huge.json()).error,'请求过大');
 assert.equal((await post(base,'/api/gallery/import',{image:data,name:'x'},'')).status,401);
 assert.equal((await post(base,'/api/gallery/import',{image:data,name:'x'},cookie,{origin:'https://evil.invalid'})).status,403);
 assert.equal(store.countImages(user.id),3);
 assert.equal(store.remaining(user.id),3);
});

test('favourites HTTP: adoption happens once, then edits are atomic add/remove',async t=>{
 const {store,server}=app(t);const base=await start(server);
 const cookie=cookieFor(store,'fav@example.invalid','fav');
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:[],initialized:false});
 assert.equal((await fetch(base+'/api/favorites')).status,401);
 assert.equal((await post(base,'/api/favorites',{ids:['catalog-53-1']},'')).status,401);
 for(const body of [{ids:'catalog-53-1'},{ids:['../etc/passwd']},{ids:['x'.repeat(41)]},{ids:['带空格 id']},{ids:Array.from({length:51},(_,i)=>'a'+i)},
                    {add:'dracula',remove:'catalog-53-1'},{},{add:''},{remove:7},[]])
  assert.equal((await post(base,'/api/favorites',body,cookie)).status,400);
 // Adoption: this device's list is stored once, duplicates dropped.
 assert.deepEqual(await (await post(base,'/api/favorites',{ids:['catalog-53-1','catalog-53-1','dracula']},cookie)).json(),{ok:true,ids:['catalog-53-1','dracula'],initialized:true});
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:['catalog-53-1','dracula'],initialized:true});
 // A second snapshot is refused with the authoritative list instead of
 // overwriting it: a device holding a stale snapshot must not resurrect a
 // favourite another device already removed.
 const conflict=await post(base,'/api/favorites',{ids:['dracula']},cookie);
 assert.equal(conflict.status,409);
 assert.deepEqual(await conflict.json(),{ok:false,ids:['catalog-53-1','dracula'],initialized:true});
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:['catalog-53-1','dracula'],initialized:true});
 assert.deepEqual(await (await post(base,'/api/favorites',{add:'dracula'},cookie)).json(),{ok:true,ids:['catalog-53-1','dracula'],initialized:true});
 assert.deepEqual(await (await post(base,'/api/favorites',{remove:'catalog-53-1'},cookie)).json(),{ok:true,ids:['dracula'],initialized:true});
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:['dracula'],initialized:true});
 // Removing what is not there still records the edit, so the other devices learn
 // about it instead of the account reading as "never synced".
 assert.deepEqual(await (await post(base,'/api/favorites',{remove:'gone'},cookie)).json(),{ok:true,ids:['dracula'],initialized:true});
 const other=cookieFor(store,'other@example.invalid','other');
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie:other}})).json(),{ids:[],initialized:false});
 assert.deepEqual(await (await post(base,'/api/favorites',{add:'dracula'},other)).json(),{ok:true,ids:['dracula'],initialized:true});
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:['dracula'],initialized:true});
});
