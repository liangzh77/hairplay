import {fixture,begin,btn,nav,poll,browser,bytes,assert,STATE_KEY,GENERATIONS_KEY} from './real-fixture.mjs';
const failures=[];let cases=0;
async function test(name,fn){if(process.env.CASE&&!name.includes(process.env.CASE))return;cases++;try{await fn();console.log('PASS '+name)}catch(e){failures.push(name);console.log('FAIL '+name+' '+e.stack)}}
const snap=p=>p.evaluate(()=>({state:localStorage.getItem('hairai.study.v1'),gen:localStorage.getItem('hairplay.generations.v1'),writes:window.reviewWrites.length}));
const cards=p=>p.locator('uni-button[aria-label^="AI 生成记录"]');
const favorites=p=>p.locator('uni-button[aria-label^="收藏的模板"]');
const seed=async(f,linked)=>{let cloud;if(linked)cloud=f.store.addImage(f.a.id,{name:'PRIVATE-A'},bytes).id;await f.p.evaluate(({cloud,image})=>localStorage.setItem('hairplay.generations.v1',JSON.stringify([{id:'gen-extra',name:'PRIVATE-A',created:'2026-10-11T00:00:00Z',source:'ai',image,...(cloud?{cloud}:{})}])),{cloud,image:'data:image/jpeg;base64,'+bytes.toString('base64')});await f.p.reload({waitUntil:'networkidle'});return cloud};
try{
for(const noBC of [false,true])for(const kind of ['favorite','generate','import','gallery','cache','download','delete','session'])await test(`cross-tab ${noBC?'storage-fallback':'BC'} late ${kind}`,async()=>{
 const f=await fixture({favorites:['catalog-53-1'],noBC});let release;try{
  const {p,context,s,store,a,b}=f;let id;if(['cache','download','delete','import'].includes(kind))id=await seed(f,kind!=='import');
  const q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});
  // The new peer cache synchronizer can heal a cleared cache first. Prevent
  // that peer download so p's actual image 200 is held, rather than time out.
  if(kind==='cache')await q.route('**/api/gallery/'+id,route=>route.abort());
  let captured=false;const gate=new Promise(r=>release=r);
  const path={favorite:'favorites',generate:'generate',import:'gallery/import',gallery:'gallery',cache:'gallery/'+id,download:'gallery/'+id,delete:'gallery/delete',session:'session'}[kind];
  await p.route('**/api/'+path,async route=>{if(captured)return route.fallback();const response=await route.fetch();assert.equal(response.status(),200);captured=true;await gate;await route.fulfill({response}).catch(()=>{});});
  if(kind==='favorite'){await p.locator('[aria-label="查看 庞巴杜发型"]').click();await btn(p,'★ 已收藏这个模板').click();}
  if(kind==='generate'||kind==='session')await begin(p);
  if(kind==='gallery')await p.reload({waitUntil:'domcontentloaded'});
  if(kind==='cache'){await p.evaluate(()=>localStorage.setItem('hairplay.generations.v1','[]'));await p.reload({waitUntil:'domcontentloaded'});}
  if(['download','delete','import'].includes(kind)){await nav(p,'画廊');await cards(p).click();if(kind==='import')await btn(p,'同步到云端').click();else if(kind==='download')await btn(p,'下载云端原图').click();else{await btn(p,'删除这张').click();await btn(p,'确认删除').click();}}
  await poll(()=>captured);await f.change(q);await q.waitForTimeout(350);const cookie=(await context.cookies()).find(c=>c.name==='hairplay');assert.equal(store.session(cookie.value).email,b.email);
  const before=await snap(p);let downloads=0;p.on('download',()=>downloads++);release();await p.waitForTimeout(650);const after=await snap(p);
  const obs={kind,noBC,cookie:store.session(cookie.value).email,stateChanged:before.state!==after.state,genChanged:before.gen!==after.gen,lateWrites:after.writes-before.writes,privateModal:await p.locator('.result-image img').count(),downloads,A_images:store.countImages(a.id),B_images:store.countImages(b.id),errors:await p.locator('.error').allTextContents(),notices:await p.locator('.notice').allTextContents()};console.log('OBSERVE '+JSON.stringify(obs));
  assert.deepEqual(after,before);assert.equal(obs.privateModal,0);assert.equal(downloads,0);assert.equal(await p.locator('.error').count(),0);assert.equal(await p.locator('.notice').count(),0);
 }finally{release?.();await f.close()}
});
// Independent list-generation counterexamples: import/delete while an earlier real GET is held.
for(const kind of ['import','delete'])await test('old gallery/cache GET vs '+kind,async()=>{
 const f=await fixture();let release;try{const {p,store,a}=f;const id=await seed(f,kind==='delete');if(kind==='delete')await p.evaluate(()=>localStorage.setItem('hairplay.generations.v1','[]'));let captured=false;const gate=new Promise(r=>release=r);
 await p.route('**/api/'+(kind==='delete'?'gallery/'+id:'gallery'),async route=>{if(captured)return route.fallback();const response=await route.fetch();captured=true;await gate;await route.fulfill({response})});
 await p.reload({waitUntil:'domcontentloaded'});await poll(()=>captured);
 if(kind==='import'){await nav(p,'画廊');await cards(p).click();await btn(p,'同步到云端').click();await p.locator('.notice').filter({hasText:'已同步到云端'}).waitFor();await btn(p,'返回相册').click();}
 else{
 // Old image-download/cache task belongs to the previous list generation.
 await nav(p,'画廊');await p.locator('.gallery-heading uni-button').click();await cards(p).click();await p.locator('uni-button').filter({hasText:/^删除所选/}).click();await btn(p,'确认删除').click();await p.locator('.notice').filter({hasText:'已删除所选'}).waitFor();}
 release();await p.waitForTimeout(600);await nav(p,'画廊');const obs={kind,server:store.countImages(a.id),cards:await cards(p).count(),cache:JSON.parse((await snap(p)).gen||'[]').length};console.log('GALLERY_ORDER '+JSON.stringify(obs));assert.equal(obs.server,kind==='import'?1:0);assert.equal(obs.cards,obs.server);assert.equal(obs.cache,obs.server);
 }finally{release?.();await f.close()}
});
// A slow preference-triggered GET captured before another tab's remove.
for(const kind of ['generate','delete'])await test('cross-tab gallery GET vs acknowledged '+kind,async()=>{
 const f=await fixture();let release;try{
  const {p,context,store,a}=f;if(kind==='delete')await seed(f,true);
  const q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});
  let captured=false;const gate=new Promise(r=>release=r);
  await p.route('**/api/gallery',async route=>{if(captured)return route.fallback();const response=await route.fetch();assert.equal(response.status(),200);captured=true;await gate;await route.fulfill({response}).catch(()=>{});});
  await p.reload({waitUntil:'domcontentloaded'});await poll(()=>captured);
  if(kind==='generate'){await begin(q);await q.locator('.result-image img').waitFor();}
  else{await nav(q,'画廊');await cards(q).click();await btn(q,'删除这张').click();await btn(q,'确认删除').click();await poll(()=>store.countImages(a.id)===0);}
  const wanted=kind==='generate'?1:0;await nav(p,'画廊');
  // Establish the peer's committed shared-cache change, not a UI update that
  // the old implementation never initiates while its first GET is held.
  await poll(()=>p.evaluate(n=>JSON.parse(localStorage.getItem('hairplay.generations.v1')||'[]').filter(r=>r.cloud).length===n,wanted));
  await q.close();await p.waitForTimeout(250);release();await p.waitForTimeout(350);
  const cache=await p.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.generations.v1')||'[]'));
  const obs={kind,server:store.countImages(a.id),cards:await cards(p).count(),cache:cache.filter(r=>r.cloud).length};console.log('CROSS_TAB_GALLERY_ORDER '+JSON.stringify(obs));
  assert.equal(obs.server,wanted);assert.equal(obs.cards,wanted);assert.equal(obs.cache,wanted);
 }finally{release?.();await f.close()}
});
await test('cross-tab stale favorite GET does not undo newer acknowledged removal',async()=>{
 const f=await fixture({favorites:['catalog-53-1']});let release,releaseLater;try{const {p,context,store,a}=f;const q=await context.newPage();await q.goto(f.url,{waitUntil:'networkidle'});let captured=false,later=false;const gate=new Promise(r=>release=r),laterGate=new Promise(r=>releaseLater=r);
 await p.route('**/api/favorites',async route=>{const response=await route.fetch();if(!captured){captured=true;await gate;}else{later=true;await laterGate;}await route.fulfill({response}).catch(()=>{});});
 await q.locator('[aria-label="关闭邀请横幅"]').click();await poll(()=>captured);
 await q.locator('[aria-label="查看 庞巴杜发型"]').click();await btn(q,'★ 已收藏这个模板').click();await q.locator('.notice').filter({hasText:'已取消收藏'}).waitFor();assert.deepEqual(store.favorites(a.id),[]);await p.waitForTimeout(200);await q.close();
 const before=await snap(p);release();await poll(()=>later);await p.waitForTimeout(200);await nav(p,'画廊');const obs={server:store.favorites(a.id),cards:await favorites(p).count(),cache:JSON.parse((await snap(p)).state).accountFavorites.items.map(x=>x.styleId),oldReadChangedCache:before.state!==(await snap(p)).state};console.log('CROSS_TAB_FAVORITE_ORDER '+JSON.stringify(obs));
 assert.deepEqual(obs.cache,[]);assert.equal(obs.cards,0);
 }finally{release?.();releaseLater?.();await f.close()}
});
console.log('EXTRA_REAL_COMPLETE cases='+cases+' failures='+JSON.stringify(failures));
}finally{await browser.close()}
if(failures.length)process.exitCode=1;
