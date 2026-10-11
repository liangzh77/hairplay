import {fixture,btn,nav,poll,browser,assert,STATE_KEY,bytes} from './real-fixture.mjs';
import {repoPath} from './harness.mjs';
const favorites=p=>p.locator('uni-button[aria-label^="收藏的模板"]');
const state=p=>p.evaluate(()=>({cache:JSON.parse(localStorage.getItem('hairai.study.v1')).accountFavorites,writes:window.reviewWrites.length}));
let failures=0,cases=0;
async function check(name,run){cases++;try{await run();console.log('PASS '+name);}catch(e){failures++;console.log('FAIL '+name+' '+e.stack);}}
try{
await check('two real atomic mutation responses reversed: lower revision cannot replace peer commit',async()=>{
 const f=await fixture({favorites:['catalog-53-1']});let release;
 try{
  const {p,context,store,a}=f,q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});
  let captured,hold=true;const gate=new Promise(r=>release=r);
  await p.route('**/api/favorites',async route=>{
   if(route.request().method()!=='POST'||!hold)return route.fallback();
   hold=false;const response=await route.fetch();assert.equal(response.status(),200);captured=await response.json();await gate;await route.fulfill({response}).catch(()=>{});
  });
  await p.locator('[aria-label="查看 庞巴杜发型"]').click();await btn(p,'★ 已收藏这个模板').click();await poll(()=>captured);
  assert.deepEqual(captured.ids,[]);
  await q.locator('[aria-label="查看 德古拉后梳油头"]').click();await btn(q,'☆ 收藏这个模板').click();await q.locator('.notice').filter({hasText:'已收藏'}).waitFor();
  const committed=store.favoritesSnapshot(a.id);assert.ok(committed.revision>captured.revision);assert.deepEqual(committed.ids,['dracula']);
  await poll(async()=>{const s=await state(p);return s.cache.revision===committed.revision;});
  const before=await state(p);release();await p.waitForTimeout(400);const after=await state(p);
  assert.deepEqual(after,before);assert.equal(await p.locator('.error').count(),0);assert.equal(await p.locator('.notice').count(),0);
  await p.locator('[aria-label="返回"]').click();await nav(p,'画廊');assert.equal(await favorites(p).filter({hasText:'庞巴杜'}).count(),0);
  console.log('REVERSED_MUTATIONS '+JSON.stringify({old:captured.revision,current:committed.revision,cache:after.cache.revision,lateWrites:after.writes-before.writes}));
 }finally{release?.();await f.close();}
});
await check('same email re-login renews context; held session 200 never restores predecessor',async()=>{
 const f=await fixture();let release;
 try{
  const {p,context,store,a}=f,q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});
  const oldCookie=(await context.cookies()).find(c=>c.name==='hairplay'),old=store.session(oldCookie.value);
  let captured=false;const gate=new Promise(r=>release=r);
  await p.route('**/api/session',async route=>{if(captured)return route.fallback();const response=await route.fetch();const body=await response.json();assert.equal(body.account.context,old.context);captured=true;await gate;await route.fulfill({response}).catch(()=>{});});
  // A true unbound session probe already captured its predecessor 200.
  await p.reload({waitUntil:'domcontentloaded'});await poll(()=>captured);
  await nav(q,'个人资料');await btn(q,'退出登录').click();await q.locator('.auth-message').filter({hasText:'已退出登录'}).waitFor();
  store.db.prepare('DELETE FROM sends').run();const code=store.issue(a.email,'relogin-fake-only');
  await q.locator('#auth-email input').fill(a.email);await q.locator('#auth-code input').fill(code);await btn(q,'注册 / 登录').click();await q.locator('.auth-message').filter({hasText:'登录成功'}).waitFor();
  const currentCookie=(await context.cookies()).find(c=>c.name==='hairplay'),current=store.session(currentCookie.value);assert.equal(current.email,old.email);assert.notEqual(current.context,old.context);
  await p.waitForTimeout(300);const before=await state(p);release();await p.waitForTimeout(400);assert.deepEqual(await state(p),before);
  // Stale logout against a NEW Cookie but same email is rejected, no Set-Cookie.
  const rejected=await p.evaluate(async context=>{const r=await fetch('api/auth/logout',{method:'POST',headers:{'content-type':'application/json','x-hairplay-context':context},body:'{}'});return {status:r.status,body:await r.json()};},old.context);
  assert.equal(rejected.status,409);assert.equal(rejected.body.code,'CONTEXT_MISMATCH');assert.ok(store.session(currentCookie.value));
  console.log('RELOGIN_CONTEXT oldDistinct=true lateProbeWrites=0 staleLogout=409');
 }finally{release?.();await f.close();}
});
await check('ABA contents do not authorize a lower revision GET; replacement GET remains held',async()=>{
 const f=await fixture({favorites:['catalog-53-1']});let releaseOld,releaseNew;
 try{
  const {p,context,store,a}=f,q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});
  let captured,later=false;const oldGate=new Promise(r=>releaseOld=r),newGate=new Promise(r=>releaseNew=r);
  await p.route('**/api/favorites',async route=>{const response=await route.fetch();if(!captured){captured=await response.json();await oldGate;}else{later=true;await newGate;}await route.fulfill({response}).catch(()=>{});});
  await q.locator('[aria-label="关闭邀请横幅"]').click();await poll(()=>captured);
  await q.locator('[aria-label="查看 庞巴杜发型"]').click();await btn(q,'★ 已收藏这个模板').click();await q.locator('.notice').filter({hasText:'已取消收藏'}).waitFor();
  await btn(q,'☆ 收藏这个模板').click();await q.locator('.notice').filter({hasText:'已收藏'}).waitFor();
  const current=store.favoritesSnapshot(a.id);assert.deepEqual(current.ids,captured.ids);assert.ok(current.revision>captured.revision);
  await poll(async()=>((await state(p)).cache.revision===current.revision));await q.close();await p.waitForTimeout(100);
  const before=await state(p);releaseOld();await poll(()=>later);await p.waitForTimeout(200);assert.deepEqual(await state(p),before);await nav(p,'画廊');assert.equal(await favorites(p).count(),0);
  console.log('ABA_REVISION '+JSON.stringify({old:captured.revision,current:current.revision,sameContents:true,lateWrites:0,replacementHeld:true}));
 }finally{releaseOld?.();releaseNew?.();await f.close();}
});
await check('unpersisted import link cannot recreate a cloud row after peer deletion while fresh GET held',async()=>{
 const f=await fixture();let release;
 try{
  const {p,context,store,a}=f;
  await p.evaluate(image=>localStorage.setItem('hairplay.generations.v1',JSON.stringify([{id:'gen-pending-link',name:'pending-link',created:'2026-10-11T00:00:00Z',source:'ai',image}])), 'data:image/jpeg;base64,'+bytes.toString('base64'));
  await p.reload({waitUntil:'networkidle'});
  await p.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='hairplay.generations.v1'){const rows=JSON.parse(v);rows.forEach(r=>delete r.cloud);v=JSON.stringify(rows);}return original.call(this,k,v);};});
  await nav(p,'画廊');await p.locator('uni-button[aria-label^="AI 生成记录"]').click();await btn(p,'同步到云端').click();await p.locator('.error').filter({hasText:'未能记住它'}).waitFor();
  assert.equal(store.countImages(a.id),1);await btn(p,'返回相册').click();
  const q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});await nav(q,'画廊');
  let held=false;const gate=new Promise(r=>release=r);
  await p.route('**/api/gallery',async route=>{const response=await route.fetch();held=true;await gate;await route.fulfill({response}).catch(()=>{});});
  await q.locator('uni-button[aria-label^="AI 生成记录"]').filter({hasText:'云端'}).click();await btn(q,'删除这张').click();await btn(q,'确认删除').click();await poll(()=>store.countImages(a.id)===0);await poll(()=>held);
  await p.waitForTimeout(150);assert.equal(await p.locator('uni-button[aria-label^="AI 生成记录"]').count(),0);assert.equal(await p.locator('.result-image img').count(),0);
  console.log('PENDING_LINK_DELETE serverImages=0 cards=0 replacementHeld=true');
 }finally{release?.();await f.close();}
});
for(const kind of ['download','generate'])await check('real context rejection quarantines '+kind+' after old-entry Cookie change without new broadcasts',async()=>{
 const f=await fixture();let release;
 try{
  const {p,context,store,a,b,s}=f;const saved=store.addImage(a.id,{name:'error-path'},bytes);await p.reload({waitUntil:'networkidle'});
  if(kind==='download'){await nav(p,'画廊');await p.locator('uni-button[aria-label^="AI 生成记录"]').click();}
  else{await nav(p,'AI匹配');const chooser=p.waitForEvent('filechooser');await p.locator('uni-button').filter({hasText:'选择本地照片'}).click();await (await chooser).setFiles(repoPath('client/src/static/catalog/ai-catalog-44-0.jpg'));await p.locator('.photo-area').waitFor();}
  const login=await p.evaluate(async body=>{const r=await fetch('api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return r.status;},{email:b.email,code:f.codeB});assert.equal(login,200);
  const cookie=(await context.cookies()).find(c=>c.name==='hairplay');assert.equal(store.session(cookie.value).email,b.email);
  // Keep any healing session probe's real B200 held. A prior private display
  // followed by quick refresh must not be mistaken for immediate isolation.
  const gate=new Promise(r=>release=r);await p.route('**/api/session',async route=>{const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});});
  let status,downloads=0;p.on('download',()=>downloads++);p.on('response',r=>{if(r.url().endsWith(kind==='download'?'api/gallery/'+saved.id:'api/generate'))status=r.status();});
  if(kind==='download')await btn(p,'下载云端原图').click();else{await btn(p,'试试 AI 发型').click();await btn(p,'确认上传并生成').click();}
  await poll(()=>status!==undefined);assert.equal(status,409);await p.waitForTimeout(200);if(kind==='download')assert.equal(await p.locator('.ai-badge').count(),0,'observed context mismatch must hide the old private detail before any session recovery');await nav(p,'画廊');
  assert.equal(await p.locator('uni-button[aria-label^="AI 生成记录"]').count(),0);assert.equal(await p.locator('.result-image img').count(),0);assert.equal(downloads,0);assert.equal(s.upstreamCalls,0);assert.equal(store.remaining(b.id),3);
  console.log('CONTEXT_REJECTION '+JSON.stringify({kind,status,cloudCards:0,downloads,upstream:s.upstreamCalls,B_remaining:3,recoveryHeld:true}));
 }finally{release?.();await f.close();}
});
console.log('SYNC_REVISIONS_REAL_COMPLETE cases='+cases+' failures='+failures);
}finally{await browser.close();}
if(failures)process.exitCode=1;
