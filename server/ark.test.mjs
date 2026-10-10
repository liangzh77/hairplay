import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApp} from './ark.mjs';
import {fixture,login,start} from './test-support.mjs';
const photo=await readFile(new URL('../client/src/static/catalog/ai-catalog-53-0.jpg',import.meta.url));
const data='data:image/jpeg;base64,'+photo.toString('base64');const origin='http://127.0.0.1:8767';
const config={key:'test-only-secret',model:'doubao-seedream-4-5-251128',endpoint:'https://ark.cn-beijing.volces.com/api/v3'};
const input=JSON.stringify({photo:data,styleId:'catalog-53-1'});
test('authenticated generation validates, strips metadata, enforces persistent budgets and never exposes key',async t=>{
 const {store,advance}=fixture(t);let calls=0,captured,fail=false,block,release;
 const app=createApp({config,auth:store,mailer:{send:async()=>{}},fetchImpl:async(url,options)=>{calls++;captured=JSON.parse(options.body);assert.equal(url,config.endpoint+'/images/generations');assert.equal(options.headers.authorization,'Bearer test-only-secret');if(block)await block;if(fail)throw Error('secret upstream stack');return new Response(JSON.stringify({data:[{b64_json:photo.toString('base64')}]}));}});
 const base=await start(app);t.after(()=>app.close());const token=login(store);const cookie='hairplay='+token;
 const send=(body,headers={})=>fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json',origin,cookie,...headers},body});
 assert.equal((await send(input,{origin:'https://evil.invalid'})).status,403);assert.equal((await send(input,{cookie:''})).status,401);assert.equal(calls,0);
 assert.equal((await send(JSON.stringify({photo:'data:text/plain;base64,SGk=',styleId:'catalog-53-1'}))).status,400);
 assert.equal((await send(JSON.stringify({photo:data,styleId:'other'}))).status,400);assert.equal(calls,0);
 fail=true;const r=await send(input);assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret'));assert.equal(store.remaining(store.session(token).id),3);fail=false;
 advance(3600001);block=new Promise(r=>release=r);const pending=send(input);
 while(calls<2)await new Promise(r=>setTimeout(r,10));const concurrent=await send(input);assert.equal(concurrent.status,429);release();assert.equal((await pending).status,200);block=null;
 for(let i=0;i<2;i++){advance(3600001);const r=await send(input);assert.equal(r.status,200);const text=await r.text();assert.ok(/data:image\/jpeg;base64/.test(text));assert.ok(!text.includes(config.key));}
 assert.equal((await send(input)).status,429);assert.equal(captured.image.length,2);assert.ok(captured.image[0]!==data);
});
test('failed reservation cleanup cannot leave in-memory generation permanently busy',async t=>{
 const {store}=fixture(t),token=login(store),cookie='hairplay='+token;let calls=0;
 const app=createApp({config,auth:store,mailer:{send:async()=>{}},fetchImpl:async()=>{calls++;if(calls===1)throw Error('upstream failure');return new Response(JSON.stringify({data:[{b64_json:photo.toString('base64')}]}));}});
 const base=await start(app);t.after(()=>app.close());
 const request=()=>fetch(base+'/api/generate',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:input});
 const original=store.finish;store.finish=(id,ok)=>{original.call(store,id,ok);throw Error('database is locked');};
 try{await request().catch(()=>{});}finally{store.finish=original;}
 assert.equal(calls,1);
 const recovered=await request();assert.equal(recovered.status,200);assert.equal(calls,2);
});
test('HTTP login/session/logout, anti-CSRF, SMTP failure sanitization and subpath Secure cookie',async t=>{
 const {store}=fixture(t);let lastCode;let fail=false;let calls=0;
 const app=createApp({config,auth:store,base:'/hairplay/',origins:['https://example.invalid'],mailer:{send:async(_,c)=>{calls++;lastCode=c;if(fail)throw Error('SMTP password secret');}},fetchImpl:async()=>{throw Error('must not call');}});
 const base=await start(app);t.after(()=>app.close());
 const post=(path,body,headers={})=>fetch(base+'/hairplay/api/'+path,{method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post('auth/code',{email:'test@example.invalid'},{origin:''})).status,403);assert.equal(calls,0);
 assert.deepEqual(await post('auth/code',{email:''}).then(r=>r.json()),{error:'请输入有效的邮箱地址'});
 assert.deepEqual(await post('auth/login',{email:'',code:''}).then(r=>r.json()),{error:'请先填写邮箱地址'});
 assert.deepEqual(await post('auth/login',{email:'wrong',code:'123456'}).then(r=>r.json()),{error:'请输入有效的邮箱地址'});
 assert.deepEqual(await post('auth/login',{email:'test@example.invalid',code:''}).then(r=>r.json()),{error:'请输入邮件里的6位数字验证码'});
 const r=await post('auth/code',{email:' TEST@Example.invalid '});assert.equal(r.status,200);assert.ok(!(await r.text()).includes(lastCode));assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await post('auth/code',{email:'test@example.invalid'},{'x-real-ip':'192.0.2.5'})).status,429);
 assert.equal((await post('auth/login',{email:'test@example.invalid',code:'wrong'})).status,400);
 assert.equal((await post('auth/login',{email:'test@example.invalid',code:lastCode,gender:'unexpected'})).status,400);
 assert.equal((await post('auth/gender',{gender:'male'})).status,401);
 const logged=await post('auth/login',{email:'test@example.invalid',code:lastCode,gender:'male'});assert.equal(logged.status,200);const set=logged.headers.get('set-cookie');assert.match(set,/HttpOnly/);assert.match(set,/Secure/);assert.match(set,/SameSite=Lax/);assert.match(set,/Path=\/hairplay\//);const cookie=set.split(';')[0];
 const session=await fetch(base+'/hairplay/api/session',{headers:{cookie}});assert.deepEqual(await session.json(),{account:{email:'test@example.invalid',gender:'male',remaining:3}});
 assert.equal((await post('auth/gender',{gender:'female'},{cookie,origin:'https://evil.invalid'})).status,403);
 assert.equal((await post('auth/gender',{gender:'unexpected'},{cookie})).status,400);
 assert.equal((await post('auth/gender',{gender:null},{cookie})).status,200);
 assert.deepEqual(await fetch(base+'/hairplay/api/session',{headers:{cookie}}).then(r=>r.json()),{account:{email:'test@example.invalid',gender:null,remaining:3}});
 assert.equal((await post('auth/gender',{gender:'female'},{cookie})).status,200);
 assert.deepEqual(await fetch(base+'/hairplay/api/session',{headers:{cookie}}).then(r=>r.json()),{account:{email:'test@example.invalid',gender:'female',remaining:3}});
 assert.equal((await fetch(base+'/hairplay/api/session',{headers:{cookie,origin:'https://evil.invalid'}})).status,403);
 assert.equal((await post('auth/logout',{}, {cookie,origin:'https://evil.invalid'})).status,403);
 assert.equal((await post('auth/logout',{}, {cookie})).status,200);
 assert.deepEqual(await fetch(base+'/hairplay/api/session',{headers:{cookie}}).then(r=>r.json()),{account:null});
 fail=true;const failed=await post('auth/code',{email:'another@example.invalid'}); // IP cooldown applies even for new addresses.
 assert.equal(failed.status,429);
});
test('unexpected SQLite lock during session/logout returns 503 without crashing the API',async t=>{
 const {store}=fixture(t),token=login(store),cookie='hairplay='+token;
 const app=createApp({config,auth:store,mailer:{send:async()=>{}}});const base=await start(app);t.after(()=>app.close());
 const savedRemaining=store.remaining, savedLogout=store.logout, savedSession=store.session;
 try{
  store.remaining=()=>{throw Error('database is locked: private SQL details');};
  const locked=await fetch(base+'/api/session',{headers:{cookie}});assert.equal(locked.status,503);assert.deepEqual(await locked.json(),{error:'服务暂不可用，请稍后重试'});
  store.remaining=savedRemaining;
  store.session=()=>{throw Error('database is locked: private SQL details');};
  assert.equal((await fetch(base+'/api/session',{headers:{cookie}})).status,503);
  store.session=savedSession;
  store.logout=()=>{throw Error('database is locked: private SQL details');};
  const out=await fetch(base+'/api/auth/logout',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:'{}'});
  assert.equal(out.status,503);assert.ok(!(await out.text()).includes('private SQL details'));
 }finally{store.remaining=savedRemaining;store.logout=savedLogout;store.session=savedSession;}
 assert.equal((await fetch(base+'/api/session',{headers:{cookie}})).status,200);
});
test('configuration is fail-closed; neither missing auth nor public plaintext origin allowed',t=>{
 const {store}=fixture(t);assert.throws(()=>createApp({config}));assert.throws(()=>createApp({config,auth:store}));assert.throws(()=>createApp({config,auth:store,mailer:{send:async()=>{}},origins:['http://example.invalid']}));assert.throws(()=>createApp({config,auth:store,mailer:{send:async()=>{}},origins:['https://example.invalid/path']}));
});
test('SMTP unavailable never retains an active code or discloses secrets',async t=>{
 const {store}=fixture(t);const app=createApp({config,auth:store,mailer:{send:async()=>{throw Error('credentials must stay private');}}});const base=await start(app);t.after(()=>app.close());
 const r=await fetch(base+'/api/auth/code',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'test@example.invalid'})});assert.equal(r.status,503);assert.ok(!(await r.text()).includes('credentials'));assert.equal(store.db.prepare('SELECT count(*) n FROM codes').get().n,0);
});
