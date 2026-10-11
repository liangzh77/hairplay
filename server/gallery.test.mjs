import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApp} from './ark.mjs';
import {GALLERY_LIMIT} from './auth.mjs';
import {fixture,login,start} from './test-support.mjs';
const picture=await readFile(new URL('../client/src/static/catalog/ai-catalog-53-0.jpg',import.meta.url));
const data='data:image/jpeg;base64,'+picture.toString('base64');
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

test('store keeps cloud pictures per account, caps imports and never leaks bytes across accounts',t=>{
 const {store}=fixture(t);
 const a=userOf(store,cookieFor(store,'a@example.invalid','a'));
 const b=userOf(store,cookieFor(store,'b@example.invalid','b'));
 const one=store.addImage(a.id,{name:'第一张',style:'catalog-53-1'},picture);
 const two=store.addImage(a.id,{name:'第二张',style:'../escape'},picture);
 assert.equal(store.countImages(a.id),2);
 assert.deepEqual(store.listImages(a.id).map(r=>r.id),[two.id,one.id]);
 assert.equal(store.listImages(b.id).length,0);
 assert.equal(store.image(b.id,one.id),null);
 assert.equal(store.image(a.id,'0'.repeat(24)),null);
 assert.equal(store.image(a.id,one.id).name,'第一张');
 assert.equal(store.image(a.id,one.id).style,'catalog-53-1');
 assert.equal(store.image(a.id,two.id).style,null);
 assert.ok(Buffer.from(store.image(a.id,one.id).bytes).equals(picture));
 store.addImage(a.id,{name:'第三张'},picture);
 assert.throws(()=>store.addImage(a.id,{name:'第四张'},picture),{status:429});
 assert.throws(()=>store.addImage(a.id,{name:'太大'},Buffer.alloc(5*1024*1024)),{status:400});
 assert.throws(()=>store.addImage(a.id,{name:'太小'},Buffer.alloc(10)),{status:400});
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
});

test('cloud album HTTP: ownership, byte-exact download, idempotent delete and private caching',async t=>{
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
 assert.equal(image.headers.get('cache-control'),'private, max-age=31536000, immutable');
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

test('import accepts only structurally complete JPEGs and stops at the account cap',async t=>{
 const {store,server}=app(t);const base=await start(server);
 const cookie=cookieFor(store,'import@example.invalid','import'),user=userOf(store,cookie);
 const ok=await post(base,'/api/gallery/import',{image:data,name:'本机旧记录',style:'catalog-53-1'},cookie);
 assert.equal(ok.status,200);
 const saved=await ok.json();
 assert.match(saved.id,/^[0-9a-f]{24}$/);
 assert.equal(saved.remaining,3);
 assert.equal(store.image(user.id,saved.id).name,'本机旧记录');
 assert.equal(store.image(user.id,saved.id).style,'catalog-53-1');
 assert.equal((await post(base,'/api/gallery/import',{image:data,name:'匿名风格',style:'../escape'},cookie)).status,200);
 assert.equal((await post(base,'/api/gallery/import',{image:data,name:'第三张'},cookie)).status,200);
 assert.equal(store.countImages(user.id),3);
 assert.equal(store.listImages(user.id).find(r=>r.name==='匿名风格').style,null);
 const full=await post(base,'/api/gallery/import',{image:data,name:'第四张'},cookie);
 assert.equal(full.status,429);
 assert.equal((await full.json()).error,'云端相册最多保存 3 张，请先删除一张');
 const bad=[
  ['data:image/png;base64,'+picture.toString('base64'),STRUCTURE],
  ['https://evil.invalid/a.jpg',STRUCTURE],
  ['data:image/jpeg;base64,AAAA',STRUCTURE],
  ['data:image/jpeg;base64,'+Buffer.concat([picture.subarray(0,picture.length-2),Buffer.from([0,0])]).toString('base64'),STRUCTURE],
  ['data:image/jpeg;base64,'+Buffer.concat([picture,Buffer.alloc(4.2*1024*1024)]).toString('base64'),STRUCTURE],
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

test('favourites: first read is uninitialised, then the account list wins and is validated',async t=>{
 const {store,server}=app(t);const base=await start(server);
 const cookie=cookieFor(store,'fav@example.invalid','fav');
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:[],initialized:false});
 assert.equal((await fetch(base+'/api/favorites')).status,401);
 assert.equal((await post(base,'/api/favorites',{ids:['catalog-53-1']},'')).status,401);
 for(const ids of ['catalog-53-1',['../etc/passwd'],['x'.repeat(41)],['带空格 id'],Array.from({length:51},(_,i)=>'a'+i)])
  assert.equal((await post(base,'/api/favorites',{ids},cookie)).status,400);
 assert.deepEqual(await (await post(base,'/api/favorites',{ids:['catalog-53-1','catalog-53-1','dracula']},cookie)).json(),{ok:true,ids:['catalog-53-1','dracula']});
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:['catalog-53-1','dracula'],initialized:true});
 assert.deepEqual(await (await post(base,'/api/favorites',{ids:[]},cookie)).json(),{ok:true,ids:[]});
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:[],initialized:true});
 const other=cookieFor(store,'other@example.invalid','other');
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie:other}})).json(),{ids:[],initialized:false});
 assert.equal((await post(base,'/api/favorites',{ids:['dracula']},other)).status,200);
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie}})).json(),{ids:[],initialized:true});
 assert.deepEqual(await (await fetch(base+'/api/favorites',{headers:{cookie:other}})).json(),{ids:['dracula'],initialized:true});
});
