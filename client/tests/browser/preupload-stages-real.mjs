// Promoted from independent4/preupload-extra: every conversion await, not only toBlob.
import {request} from 'node:http';
import {fixture,btn,nav,poll,browser,assert} from './real-fixture.mjs';
import {repoPath} from './harness.mjs';
const failures=[];let cases=0;
async function check(name,run){cases++;try{await run();console.log('PASS '+name);}catch(e){failures.push(name);console.log('FAIL '+name+' '+e.stack);}}
try{
for(const sameTab of [false,true])for(const noBC of [false,true])for(const stage of ['decode','blob','reader'])await check(`${stage} switch ${sameTab?'same-tab':'peer'} ${noBC?'fallback':'BC'}`,async()=>{
 const f=await fixture({noBC});
 try{
  const {p,context,s,store,a,b}=f,q=sameTab?p:await context.newPage();if(!sameTab)await q.goto(f.url,{waitUntil:'networkidle'});
  await nav(p,'AI匹配');const chooser=p.waitForEvent('filechooser');await p.locator('uni-button').filter({hasText:'选择本地照片'}).click();await (await chooser).setFiles(repoPath('client/src/static/catalog/ai-catalog-44-0.jpg'));await p.locator('.photo-area').waitFor();
  await p.evaluate(stage=>{
   window.blocked=false;window.completed=false;
   if(stage==='decode'){const original=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=async function(){await original.call(this);if(!window.blocked){window.blocked=true;await new Promise(r=>window.resume=()=>{window.completed=true;r();});}};}
   if(stage==='blob'){const original=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,...args){return original.call(this,blob=>{if(!window.blocked){window.blocked=true;window.resume=()=>{window.completed=true;callback(blob);};}else callback(blob);},...args);};}
   if(stage==='reader'){const original=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(...args){if(!window.blocked){window.blocked=true;window.resume=()=>{window.completed=true;original.apply(this,args);};}else original.apply(this,args);};}
  },stage);
  await btn(p,'试试 AI 发型').click();await btn(p,'确认上传并生成').click();await poll(()=>p.evaluate(()=>window.blocked));await f.change(q);await q.waitForTimeout(250);await p.evaluate(()=>window.resume());await poll(()=>p.evaluate(()=>window.completed));await p.waitForTimeout(350);
  const observed={stage,sameTab,noBC,posts:s.generateRequests.length,upstream:s.upstreamCalls,A_images:store.countImages(a.id),B_images:store.countImages(b.id),B_remaining:store.remaining(b.id)};
  console.log('PREUPLOAD '+JSON.stringify(observed));assert.equal(observed.posts,0);assert.equal(observed.upstream,0);assert.equal(observed.A_images,0);assert.equal(observed.B_images,0);assert.equal(observed.B_remaining,3);
 }finally{await f.close();}
});
await check('mismatched context with no photo body rejects immediately and performs zero paid work',async()=>{
 const f=await fixture();try{
  const old=f.store.session(f.token).context;await f.change(f.p);const cookie=(await f.context.cookies()).find(c=>c.name==='hairplay').value,url=new URL('api/generate',f.url);let reserves=0;const original=f.store.reserve.bind(f.store);f.store.reserve=(...args)=>{reserves++;return original(...args);};
  const status=await new Promise((resolve,reject)=>{const req=request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json',cookie:'hairplay='+cookie,'x-hairplay-context':old,'content-length':'1000000'}},res=>{res.resume();res.on('end',()=>{resolve(res.statusCode);req.destroy();});});req.setTimeout(2500,()=>req.destroy(Error('server waited for body')));req.on('error',reject);req.flushHeaders();});
  assert.equal(status,409);assert.equal(reserves,0);assert.equal(f.s.upstreamCalls,0);assert.equal(f.store.countImages(f.b.id),0);assert.equal(f.store.remaining(f.b.id),3);
  console.log('CONTEXT_HEADER_ONLY status=409 bodyBytes=0 reserves=0 upstream=0');
 }finally{await f.close();}
});
console.log('PREUPLOAD_STAGES_REAL_COMPLETE cases='+cases+' failures='+JSON.stringify(failures));
}finally{await browser.close();}
if(failures.length)process.exitCode=1;
