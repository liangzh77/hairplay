import {fixture,btn,nav,poll,browser,assert,STATE_KEY} from './real-fixture.mjs';
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
console.log('SYNC_REVISIONS_REAL_COMPLETE cases='+cases+' failures='+failures);
}finally{await browser.close();}
if(failures)process.exitCode=1;
