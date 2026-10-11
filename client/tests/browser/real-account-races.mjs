import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
// Promoted from Astra high's independent real-API probes; upstream/email are fake-only.
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthStore} from '../../../server/auth.mjs';
import {createApp} from '../../../server/ark.mjs';
import {assert,startStatic,launchBrowser,repoPath,STATE_KEY,GENERATIONS_KEY} from './harness.mjs';
const bytes=readFileSync(repoPath('client/src/static/catalog/ai-catalog-53-0.jpg'));
const browser=await launchBrowser(),failures=[];
const btn=(p,t)=>p.locator('uni-button').filter({hasText:new RegExp('^'+t+'$')});
const nav=(p,t)=>p.locator('[aria-label="导航 '+t+'"]').click();
const poll=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30))}throw Error('timeout')};
async function begin(p){await nav(p,'AI匹配');const chooser=p.waitForEvent('filechooser');chooser.catch(()=>{});await p.locator('uni-button').filter({hasText:'选择本地照片'}).click();await (await chooser).setFiles(repoPath('client/src/static/catalog/ai-catalog-44-0.jpg'));await p.locator('.photo-area').waitFor();await btn(p,'试试 AI 发型').click();await btn(p,'确认上传并生成').click();}
async function fixture({favorites=[]}={}){
 const dir=mkdtempSync(join(tmpdir(),'hairplay-real-race-')),store=new AuthStore(dir+'/auth.sqlite');
 const A='a@example.invalid',B='b@example.invalid';
 const token=store.verify(A,store.issue(A,'a')),a=store.session(token);
 const firstB=store.verify(B,store.issue(B,'b')),b=store.session(firstB);store.logout(firstB);store.db.prepare('DELETE FROM sends').run();
 const codeB=store.issue(B,'b-login');store.setFavorites(a.id,favorites);store.setFavorites(b.id,['catalog-44-1']);
 let app;const s={upstreamCalls:0,generateRequests:[],holdUpstream:false,release:null};const server=await startStatic({handler:(req,res,url)=>{if(!url.pathname.startsWith('/hairplay/api/'))return false;
  if(url.pathname.endsWith('/generate')){const token=(req.headers.cookie||'').split('hairplay=')[1]?.split(';')[0];s.generateRequests.push({owner:store.session(token)?.email});}
  app.emit('request',req,res);return true;
 }});
 app=createApp({auth:store,config:{key:'FAKE-ONLY',model:'fake-only',endpoint:'https://never-contact.invalid'},mailer:{send:async()=>{throw Error('REAL EMAIL FORBIDDEN')}},origins:[server.origin],base:'/hairplay/',fetchImpl:async()=>{s.upstreamCalls++;if(s.holdUpstream)await new Promise(r=>s.release=r);return new Response(JSON.stringify({data:[{b64_json:bytes.toString('base64')}]}));}});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(()=>{window.reviewWrites=[];const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){let rows;try{rows=JSON.parse(v)}catch{};window.reviewWrites.push({key:k,clouds:Array.isArray(rows)?rows.map(r=>r.cloud||null):null});return set.call(this,k,v)}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===server.origin?route.continue():route.abort());
 await context.addCookies([{name:'hairplay',value:token,domain:'127.0.0.1',path:'/hairplay/',httpOnly:true,sameSite:'Lax'}]);
 const p=await context.newPage();p.setDefaultTimeout(5000);await p.goto(server.url,{waitUntil:'networkidle'});
 const change=async page=>{await nav(page,'个人资料');await btn(page,'退出登录').click();await page.locator('.auth-message').filter({hasText:'已退出登录'}).waitFor();await page.locator('#auth-email input').fill(B);await page.locator('#auth-code input').fill(codeB);await btn(page,'注册 / 登录').click();await page.locator('.auth-message').filter({hasText:'登录成功'}).waitFor();};
 return {p,context,s,store,a,b,change,url:server.url,close:async()=>{s.release?.();await context.close();await server.close();app.close();store.close();rmSync(dir,{recursive:true,force:true})}};
}
try{
{
 const f=await fixture();try{
  const {p,s,store,a,b,change}=f;
  await p.evaluate(()=>{const orig=HTMLCanvasElement.prototype.toBlob;window.blocked=false;HTMLCanvasElement.prototype.toBlob=function(...args){if(!window.blocked){window.blocked=true;window.releaseCanvas=()=>{const cb=args[0];args[0]=blob=>{cb(blob);window.encodeDone=true};orig.apply(this,args)}}else orig.apply(this,args)}});
  await begin(p);await poll(()=>p.evaluate(()=>window.blocked));assert.equal(s.generateRequests.length,0);await change(p);await p.evaluate(()=>window.releaseCanvas());await poll(()=>p.evaluate(()=>window.encodeDone));await p.waitForTimeout(150);
  const obs={requests:s.generateRequests,upstreamCalls:s.upstreamCalls,A_images:store.countImages(a.id),B_images:store.countImages(b.id),B_remaining:store.remaining(b.id)};console.log('REAL_PREUPLOAD '+JSON.stringify(obs));
  assert.equal(s.generateRequests.length,0);assert.equal(s.upstreamCalls,0);assert.equal(store.countImages(a.id),0);assert.equal(store.countImages(b.id),0);assert.equal(store.remaining(b.id),3);
 }finally{await f.close()}
}
{
 const f=await fixture();let unblockSession;try{
  const {p,context,s,store,a,b,change}=f,q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});s.holdUpstream=true;await begin(p);await poll(()=>!!s.release);
  await change(q);await q.waitForTimeout(250);
  let sessionHeld=false;const sessionGate=new Promise(r=>unblockSession=r);
  await p.route('**/api/session',async route=>{const response=await route.fetch();sessionHeld=true;await sessionGate;await route.fulfill({response})});
  const before=await p.evaluate(()=>({gen:localStorage.getItem('hairplay.generations.v1'),state:localStorage.getItem('hairai.study.v1'),writes:window.reviewWrites.length}));
  const received=p.waitForResponse(r=>r.url().endsWith('/api/generate'));s.release();await received;await p.waitForTimeout(300);
  const after=await p.evaluate(()=>({gen:localStorage.getItem('hairplay.generations.v1'),state:localStorage.getItem('hairai.study.v1')}));
  const currentCookie=(await context.cookies()).find(x=>x.name==='hairplay');
  const obs={cookieOwner:store.session(currentCookie.value).email,privateModal:await p.locator('.result-image img').count(),privateDataUrl:await p.locator('.result-image img').count()>0,A_images:store.countImages(a.id),B_images:store.countImages(b.id),generationStorageChanged:after.gen!==before.gen,generationRows:JSON.parse(after.gen||'[]').length,lateTabAWrites:await p.evaluate(n=>window.reviewWrites.slice(n),before.writes)};console.log('REAL_CROSS_TAB '+JSON.stringify(obs));
  if(obs.privateModal||obs.generationStorageChanged)failures.push('other-tab logout/login does not invalidate A result');
  assert.equal(obs.privateModal,0);assert.equal(after.state,before.state);assert.equal(obs.generationStorageChanged,false);assert.deepEqual(obs.lateTabAWrites,[]);
  unblockSession();await p.waitForTimeout(200);
 }finally{unblockSession?.();await f.close()}
}
{
 const f=await fixture({favorites:['catalog-53-1']});let release;try{
  const {p,s,store,a,context}=f;const q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});let captured=false;const gate=new Promise(r=>release=r);
  await p.route('**/api/favorites',async route=>{if(route.request().method()!=='GET')return route.fallback();const response=await route.fetch();captured=true;await gate;return route.fulfill({response})});
  await q.locator('[aria-label="关闭邀请横幅"]').click();await poll(()=>captured);await q.close();await p.locator('[aria-label="查看 庞巴杜发型"]').click();await btn(p,'★ 已收藏这个模板').click();await p.locator('.notice').filter({hasText:'已取消收藏'}).waitFor();release();await p.waitForTimeout(300);await p.locator('[aria-label="返回"]').click();await nav(p,'画廊');
  const obs={server:store.favorites(a.id),cards:await p.locator('uni-button[aria-label^="收藏的模板"]').count(),cached:await p.evaluate(()=>JSON.parse(localStorage.getItem('hairai.study.v1')).accountFavorites.items.map(f=>f.styleId))};console.log('REAL_STALE_FAVORITES '+JSON.stringify(obs));if(obs.cards!==0)failures.push('stale favorites GET resurrects cancelled template');
 }finally{release?.();await f.close()}
}
{
 const f=await fixture();let release;try{
  const {p,store,a}=f;let captured=false;const gate=new Promise(r=>release=r);
  await p.route('**/api/gallery',async route=>{if(captured)return route.fallback();const response=await route.fetch();console.log('REAL_STALE_GALLERY_CAPTURE '+await response.text());captured=true;await gate;await route.fulfill({response});console.log('REAL_STALE_GALLERY_RELEASED')});
  await p.reload({waitUntil:'domcontentloaded'});await poll(()=>captured);await begin(p);await p.locator('.result-image img').waitFor();await btn(p,'关闭').click();await nav(p,'画廊');assert.equal(await p.locator('uni-button[aria-label^="AI 生成记录"]').count(),1);const received=p.waitForResponse(r=>new URL(r.url()).pathname==='/hairplay/api/gallery');release();await received;await p.waitForTimeout(1200);
  const obs={serverImages:store.countImages(a.id),cards:await p.locator('uni-button[aria-label^="AI 生成记录"]').count(),remaining:store.remaining(a.id)};console.log('REAL_STALE_GALLERY '+JSON.stringify(obs));if(obs.cards!==1)failures.push('stale gallery GET hides a successful paid result');
 }finally{release?.();await f.close()}
}
console.log('REAL_ACCOUNT_RACES_COMPLETE failures='+JSON.stringify(failures));
}finally{await browser.close()}
if(failures.length)process.exitCode=1;
