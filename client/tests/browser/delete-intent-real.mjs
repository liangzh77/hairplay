// Deterministic confirmation windows, real HTTP/AuthStore/SQLite; no upstream calls.
import {fixture,btn,nav,poll,browser,bytes,assert,GENERATIONS_KEY} from './real-fixture.mjs';
import {readRepo} from './harness.mjs';
const cases=['peer','get-held','get-failed','already-deleted','cancel','account-change','identity-held','same-owner-login','single-failure','batch-peer','batch-partial','batch-cancel'];
async function run(kind){
 const f=await fixture({noBC:process.env.NO_BC==='1'});
 let release=()=>{};
 try{
  const {p:one,context,store,a}=f;
  const A=store.addImage(a.id,{name:'稳定目标 A'},bytes);
  const B=store.addImage(a.id,{name:'稳定目标 B'},await readRepo('client/src/static/catalog/ai-catalog-44-1.jpg'));
  const two=await context.newPage();two.setDefaultTimeout(5000);
  const requests=[],responses=[],pending=[],errors=[];
  context.on('request',r=>{if(r.url().endsWith('/gallery/delete')){
   const token=r.headers().cookie?.match(/hairplay=([^;]+)/)?.[1];
   requests.push({id:r.postDataJSON().id,context:r.headers()['x-hairplay-context'],owner:store.session(token)?.email});
   // Register at request time: a committed POST may not have delivered its response yet.
   const parsed=context.waitForEvent('response',{predicate:response=>response.request()===r})
    .then(async response=>responses.push({status:response.status(),body:await response.json()}));
   parsed.catch(()=>{}); // The shared barrier below propagates failures, not an event callback.
   pending.push(parsed);
  }});
  const collectResponses=()=>Promise.all(pending);
  for(const p of [one,two]){p.on('pageerror',e=>errors.push(e.message));await p.goto(f.url,{waitUntil:'networkidle'});await p.waitForFunction(k=>JSON.parse(localStorage.getItem(k)||'[]').length===2,GENERATIONS_KEY);await nav(p,'画廊');}
  const open=async(p,name)=>{await p.locator(`[aria-label="AI 生成记录 稳定目标 ${name}"]`).click();await btn(p,'删除这张').click();assert.ok((await p.locator('.modal-copy').innerText()).includes('稳定目标 '+name));};
  if(kind.startsWith('batch')){
   await btn(two,'选择').click();
   for(const name of ['A','B'])await two.locator(`[aria-label="AI 生成记录 稳定目标 ${name}"]`).click();
   await btn(two,'删除所选（2）').click();
   assert.match(await two.locator('.modal-title').innerText(),/2 张/);
  }else await open(two,'B');
  const contextBefore=(await two.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.gallery.stamp.v2')))).context;
  if(kind==='account-change'||kind==='identity-held'||kind==='same-owner-login'){
   let probeSeen=false;
   if(kind==='identity-held'){
    const heldProbe=new Promise(r=>release=r);
    await two.route('**/api/session',async route=>{probeSeen=true;await heldProbe;await route.continue();});
   }
   if(kind!=='same-owner-login')await f.change(one);
   else{
    await nav(one,'个人资料');await btn(one,'退出登录').click();await one.locator('.auth-message').filter({hasText:'已退出登录'}).waitFor();
    const code=store.issue(a.email,'relogin');
    await one.locator('#auth-email input').fill(a.email);await one.locator('#auth-code input').fill(code);await btn(one,'注册 / 登录').click();await one.locator('.auth-message').filter({hasText:'登录成功'}).waitFor();
   }
   if(kind==='identity-held')await poll(()=>probeSeen);
   await poll(async()=>await two.locator('.modal-copy').count()===0);
   assert.equal(await btn(two,'确认删除').count(),0);release();assert.equal(requests.length,0);assert.equal(store.countImages(a.id),2);
   const cookie=(await context.cookies()).find(c=>c.name==='hairplay');assert.notEqual(store.session(cookie.value).context,contextBefore);
  }else if(kind==='cancel'||kind==='batch-cancel'){
   let captured;
   if(process.env.HOLD_DELETE_RESPONSE==='1'){
    const held200=new Promise(r=>release=r);
    let capture;
    captured=new Promise(resolve=>capture=resolve);
    await two.route('**/api/gallery/delete',async route=>{
     const response=await route.fetch();
     capture({status:response.status(),body:await response.json()});
     await held200;await route.fulfill({response});
    });
   }
   await two.locator('.modal uni-button').filter({hasText:/^取消$/}).click();assert.equal(await btn(two,'确认删除').count(),0);assert.equal(requests.length,0);
   // Reopening must capture A, not the cancelled B.
   if(kind==='batch-cancel')await btn(two,'取消').click();else await two.locator('[aria-label="返回"]').click();await open(two,'A');await btn(two,'确认删除').click();await poll(()=>store.countImages(a.id)===1);
   assert.equal(requests[0].id,A.id);assert.equal(store.listImages(a.id)[0].id,B.id);
   if(captured){
    const original=await captured;
    assert.equal(original.status,200);assert.equal(original.body.deleted,true);assert.equal(original.body.revision,3);
    let complete=false;
    const barrier=collectResponses().then(()=>{complete=true;});
    // A browser round-trip checkpoints microtasks, not a sleep or a retry for green.
    const heldUI=await two.evaluate(()=>({copy:document.querySelector('.modal-copy')?.textContent,disabled:document.querySelector('.modal .danger')?.hasAttribute('disabled')}));
    assert.equal(complete,false,'collector must wait for the held response and parsed body');
    assert.equal(pending.length,1);assert.equal(responses.length,0);
    assert.equal(store.gallerySnapshot(a.id).revision,3);
    assert.ok(heldUI.copy.includes('稳定目标 A'));assert.equal(heldUI.disabled,true);
    console.log('DELETE_COLLECTOR_HELD '+JSON.stringify({kind,noBC:process.env.NO_BC==='1',original,requests,responses,pendingCount:pending.length,sqlite:store.gallerySnapshot(a.id),heldUI,complete}));
    release();await barrier;assert.equal(complete,true);
   }
  }else{
   let getSeen=false;
   const held=new Promise(r=>release=r);
   if(kind==='get-held'||kind==='get-failed')await two.route('**/api/gallery',async route=>{getSeen=true;if(kind==='get-held'){await held;await route.continue();}else await route.fulfill({status:503,json:{error:'deterministic gallery failure'}});});
   if(kind==='single-failure')await two.route('**/api/gallery/delete',route=>route.fulfill({status:503,json:{error:'deterministic delete failure'}}));
   if(kind==='batch-partial')await two.route('**/api/gallery/delete',route=>route.request().postDataJSON().id===B.id?route.fulfill({status:503,json:{error:'deterministic partial failure'}}):route.continue());
   if(!['single-failure','batch-partial'].includes(kind)){
    await open(one,kind==='already-deleted'?'B':'A');await btn(one,'确认删除').click();
    await two.waitForFunction(()=>!document.querySelector('.generated-image'));
    if(kind==='get-held'||kind==='get-failed')await poll(()=>getSeen);
    else await two.waitForFunction(()=>document.querySelectorAll('.gallery-card').length===1);
    assert.equal(await btn(two,'确认删除').count(),1);
    const copy=await two.locator('.modal-copy').innerText();assert.ok(!copy.includes('「」'));
    if(!kind.startsWith('batch'))assert.ok(copy.includes('稳定目标 B'));
   }
   await btn(two,'确认删除').click();
   await poll(async()=>await btn(two,'确认删除').count()===0);
   release();
   if(kind==='single-failure'||kind==='batch-partial'){
    assert.match(await two.locator('.error').innerText(),/云端删除未完成：/);
    assert.equal(store.countImages(a.id),kind==='single-failure'?2:1);
    if(kind==='batch-partial'){assert.equal(store.listImages(a.id)[0].id,B.id);assert.match(await two.locator('.error').innerText(),/1\/2/);}
   }else{const count=kind==='already-deleted'?1:0;await poll(()=>store.countImages(a.id)===count);assert.equal(store.countImages(a.id),count);}
   const expected=kind==='batch-peer'?[A.id,A.id,B.id]:kind==='batch-partial'?[A.id,B.id]:kind==='single-failure'?[B.id]:kind==='already-deleted'?[B.id,B.id]:[A.id,B.id];
   assert.deepEqual(requests.map(r=>r.id),expected);
  }
  // Other mutation branches already wait for UI completion (and thus all batch requests).
  // Cancel/reopen has exactly one request; identity-cancel branches have none.
  await collectResponses();
  await btn(two,'确认删除').waitFor({state:'hidden'});
  assert.equal(responses.length,requests.length);
  assert.ok(requests.every(r=>r.owner===a.email&&r.context===contextBefore));assert.deepEqual(errors,[]);assert.equal(f.s.upstreamCalls,0);
  const snapshot=store.gallerySnapshot(a.id);
  const successCount=responses.filter(r=>r.status===200&&r.body.deleted).length;
  assert.equal(snapshot.revision,2+successCount);
  if(kind==='already-deleted')assert.equal(responses.at(-1).body.deleted,false);
  const ui=await two.evaluate(()=>({confirm:!![...document.querySelectorAll('uni-button')].find(e=>e.textContent==='确认删除'),copy:document.querySelector('.modal-copy')?.textContent,error:[...document.querySelectorAll('.error')].map(e=>e.textContent),notice:[...document.querySelectorAll('.notice')].map(e=>e.textContent)}));
  console.log('DELETE_INTENT_REAL_PASS '+JSON.stringify({kind,noBC:process.env.NO_BC==='1',targets:{A:A.id,B:B.id},requests,responses,sqlite:snapshot,ui,pageErrors:errors}));
 }finally{release();await f.close();}
}
try{for(const kind of cases.filter(k=>!process.env.CASE||k===process.env.CASE))await run(kind);}finally{await browser.close();}
