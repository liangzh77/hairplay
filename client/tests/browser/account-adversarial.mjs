import {assert,launchBrowser,startStatic,jpegDataUrl,readRepo,repoPath,STATE_KEY,GENERATIONS_KEY} from './harness.mjs';
// Regression promoted from the independent Astra high review's fake-only probes.
const server=await startStatic(),browser=await launchBrowser(),contexts=[],issues=[];
const bytes=await readRepo('client/src/static/catalog/ai-catalog-53-0.jpg'),jpeg=await jpegDataUrl();
const catalog=JSON.parse(await readRepo('client/src/core/catalog.json'));
const A='a@example.invalid',B='b@example.invalid',created='2026-10-11T00:00:00.000Z',id='a'.repeat(24);
const acct=(email,context)=>email?{email,context,gender:null,remaining:3}:null;
const row={id,name:'PRIVATE-A',created,style:null,size:bytes.length};
const fav=s=>{const x=catalog.find(x=>x.id===s);return {id:'fav-'+s,styleId:s,name:x.name,image:x.image,created}};
const local=(cloud)=>({id:'gen-independent',name:'PRIVATE-A',created,image:jpeg,source:'ai',...(cloud?{cloud}: {})});
const btn=(p,t)=>p.locator('uni-button').filter({hasText:new RegExp('^'+t+'$')});
const nav=(p,t)=>p.locator('[aria-label="导航 '+t+'"]').click();
const cards=p=>p.locator('uni-button[aria-label^="AI 生成记录"]');
const favcards=p=>p.locator('uni-button[aria-label^="收藏的模板"]');
const poll=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25))}throw Error('poll timeout')};
const storage=p=>p.evaluate(()=>Object.fromEntries(['hairai.study.v1','hairplay.generations.v1'].map(k=>[k,localStorage.getItem(k)])));
const stateOf=async p=>JSON.parse((await storage(p))[STATE_KEY]);
const recordsOf=async p=>JSON.parse((await storage(p))[GENERATIONS_KEY]);
const ids=items=>items.map(f=>f.styleId);
async function setup({session=A,favorites=['catalog-53-1'],records=[],state={},images=[],noLocks=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});contexts.push(context);
 await context.addInitScript(({state,records,noLocks})=>{
  if(!localStorage.getItem('hairplay.generations.v1')){localStorage.setItem('hairplay.generations.v1',JSON.stringify(records));localStorage.setItem('hairai.study.v1',JSON.stringify({version:1,favorites:[],favoritesSeparated:true,...state}));}
  window.writes=[];const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){window.writes.push(k);return set.call(this,k,v)};
  if(noLocks)Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
 },{state,records,noLocks});
 const s={contexts:{[A]:'a'.repeat(32),[B]:'b'.repeat(32)},loginGeneration:0,revisions:{[A]:{favorites:0,gallery:0},[B]:{favorites:0,gallery:0}},session,favorites:{[A]:favorites,[B]:['catalog-44-1']},images:{[A]:images,[B]:[]},events:[],holds:{},gets:0,imports:0,generates:0,errors:[],downloads:0};
 s.hold=key=>{let release;const gate=new Promise(r=>release=r);const h={gate,release,started:false,done:false};s.holds[key]=h;return h};
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());if(u.origin!==server.origin)return route.abort();
  if(!u.pathname.includes('/api/'))return route.continue();
  const path=u.pathname.split('/api/')[1],method=req.method(),owner=s.session;const body=method==='POST'?req.postDataJSON():null;
  const event={path,method,owner,body};s.events.push(event);
  const sessionContext=s.contexts[owner],beforeFavorites=JSON.stringify(s.favorites[owner]),beforeImages=JSON.stringify(s.images[owner]);
  let result={},status=200,picture=false;
  if(path==='session')result={account:acct(owner,sessionContext)};
  else if(path==='auth/login'){s.session=body.email;s.contexts[body.email]=(++s.loginGeneration).toString(16).padStart(32,'0');result={ok:true,account:acct(body.email,s.contexts[body.email])};}
  else if(path==='auth/logout'){s.session=null;result={ok:true};}
  else if(path==='auth/gender')result={ok:true};
  else if(path==='favorites'){
   if(method==='POST'){
    if(Array.isArray(body.ids)){if(s.favorites[owner]!==null){status=409;result={ok:false,ids:[...s.favorites[owner]],initialized:true};}else{s.favorites[owner]=[...body.ids];result={ok:true,ids:[...body.ids],initialized:true};}}
    else {s.favorites[owner]=body.add?[...new Set([body.add,...(s.favorites[owner]||[])])]:(s.favorites[owner]||[]).filter(x=>x!==body.remove);result={ok:true,ids:[...s.favorites[owner]],initialized:true};}
   }else result={ids:[...(s.favorites[owner]||[])],initialized:s.favorites[owner]!==null};
  }else if(path==='gallery')result={images:[...(s.images[owner]||[])]};
  else if(path==='gallery/import'){s.imports++;s.images[owner]=[row];result={id,created};}
  else if(path==='generate'){s.generates++;s.images[owner]=[row];result={image:jpeg,record:{id,created},remaining:2};}
  else if(path==='gallery/delete'){s.images[owner]=[];result={deleted:true};}
  else if(path.startsWith('gallery/')){s.gets++;picture=true;}
  else {status=404;result={error:'FAKE-ONLY unknown route'};}
  // Simulated server commits and v2 metadata are captured BEFORE holding the
  // genuine successful response; never stamp late A results with current B.
  const resource=path==='favorites'?'favorites':path==='gallery'||path.startsWith('gallery/')||path==='generate'?'gallery':null;
  if(resource){
   if(method==='POST'&&(resource==='favorites'?beforeFavorites!==JSON.stringify(s.favorites[owner]):beforeImages!==JSON.stringify(s.images[owner])))s.revisions[owner][resource]++;
   result={...result,owner,context:sessionContext,revision:s.revisions[owner][resource],...(resource==='gallery'&&!picture?{images:[...s.images[owner]]}:{})};
  }else if(path==='auth/gender')result={...result,owner,context:sessionContext};
  const imageHeaders=picture?{'x-hairplay-owner':owner,'x-hairplay-context':sessionContext,'x-hairplay-revision':String(s.revisions[owner].gallery)}:{};
  // Hold a captured response after server-side effects, not after logout's 401.
  const key=method+' '+path,h=s.holds[key];if(h){delete s.holds[key];h.started=true;h.event=event;await h.gate;}
  await route.fulfill({status,contentType:picture?'image/jpeg':'application/json',headers:imageHeaders,body:picture?bytes:JSON.stringify(result)}).catch(()=>{});
  if(h)h.done=true;
 });
 const page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>s.errors.push(e.message));page.on('download',()=>s.downloads++);
 await page.goto(server.url,{waitUntil:'networkidle'});return {page,context,s};
}
async function logout(p){await nav(p,'个人资料');await btn(p,'退出登录').click();await p.locator('.auth-message').filter({hasText:'已退出登录'}).waitFor();}
async function login(p,email=B){await nav(p,'个人资料');await p.locator('#auth-email input').fill(email);await p.locator('#auth-code input').fill('123456');await btn(p,'注册 / 登录').click();await p.locator('.auth-message').filter({hasText:'登录成功'}).waitFor();}
async function choose(p,s='catalog-53-1'){await nav(p,'发现');await p.locator('[aria-label="查看 '+catalog.find(x=>x.id===s).name+'"]').click();}
async function beginGenerate(p){await nav(p,'AI匹配');const chooser=p.waitForEvent('filechooser');chooser.catch(()=>{});await p.locator('uni-button').filter({hasText:'选择本地照片'}).click();await (await chooser).setFiles(repoPath('client/src/static/catalog/ai-catalog-44-0.jpg'));await p.locator('.photo-area').waitFor();await btn(p,'试试 AI 发型').click();await btn(p,'确认上传并生成').click();}
async function settle(p){await p.waitForTimeout(250)}
async function check(name,fn){if(process.env.CASE&&!name.includes(process.env.CASE))return;try{await fn();console.log('PASS '+name)}catch(e){issues.push(name);console.log('FAIL '+name+' '+e.stack)}}
try{
await check('legacy overlap removed; local-only retained; anonymous add survives existing-account relogin',async()=>{
 const {page:p,s}=await setup({state:{favoritesSeparated:false,favorites:[fav('catalog-53-1'),fav('dracula')]}});
 assert.deepEqual(ids((await stateOf(p)).favorites),['dracula']);await nav(p,'画廊');assert.equal(await favcards(p).count(),1);
 await logout(p);await nav(p,'画廊');assert.match(await favcards(p).innerText(),new RegExp(catalog.find(x=>x.id==='dracula').name));
 await choose(p,'catalog-44-1');await btn(p,'☆ 收藏这个模板').click();await p.locator('.notice').filter({hasText:'未登录'}).waitFor();await p.locator('[aria-label="返回"]').click();
 await login(p,A);await nav(p,'画廊');assert.equal(await favcards(p).count(),1);assert.deepEqual(ids((await stateOf(p)).favorites).sort(),['catalog-44-1','dracula']);
 await logout(p);await nav(p,'画廊');assert.equal(await favcards(p).count(),2);assert.deepEqual(s.favorites[A],['catalog-53-1']);
});
await check('successful adoption clears only captured ids; concurrent local addition retained',async()=>{
 const {page:p,context,s}=await setup({session:null,favorites:null,state:{favorites:[fav('catalog-53-1')]}});
 const q=await context.newPage();await q.goto(server.url,{waitUntil:'networkidle'});const h=s.hold('POST favorites');await login(p,A);await poll(()=>h.started);
 // Login now propagates to every tab, so q cannot pretend to remain anonymous.
 // Insert a valid concurrent local-only record under the real state lock instead.
 await q.evaluate(async ({key,entry})=>{await navigator.locks.request('hairplay.storage.'+key,()=>{const state=JSON.parse(localStorage.getItem(key));state.favorites.push(entry);localStorage.setItem(key,JSON.stringify(state));});},{key:STATE_KEY,entry:fav('dracula')});
 h.release();await poll(()=>h.done);await settle(p);
 assert.deepEqual(ids((await stateOf(p)).favorites),['dracula']);assert.deepEqual(s.favorites[A],['catalog-53-1']);await logout(p);await nav(p,'画廊');assert.equal(await favcards(p).count(),1);
});
await check('409 adoption preserves legacy and explicit local favorites',async()=>{
 for(const separated of [false,true]){
  const {page:p,s}=await setup({session:null,favorites:null,state:{favoritesSeparated:separated,favorites:[fav('dracula')]}});
  const h=s.hold('GET favorites');await login(p,A);await poll(()=>h.started);s.favorites[A]=['catalog-53-1'];h.release();await poll(async()=>s.events.some(e=>e.path==='favorites'&&e.method==='POST'));await settle(p);
  assert.deepEqual(ids((await stateOf(p)).favorites),['dracula']);assert.deepEqual(s.favorites[A],['catalog-53-1']);assert.equal(s.events.filter(e=>e.path==='favorites'&&e.method==='POST').length,1);
 }
});
await check('N4 lost cloud field then real native-lock retry updates detail without reimport',async()=>{
 const {page:p,s}=await setup({records:[local()]});await p.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='hairplay.generations.v1'){const rows=JSON.parse(v);rows.forEach(r=>delete r.cloud);v=JSON.stringify(rows)}return window.originalSet.call(this,k,v)}});
 await nav(p,'画廊');await cards(p).click();await btn(p,'同步到云端').click();await p.locator('.error').filter({hasText:'未能记住它'}).waitFor();assert.equal(s.imports,1);assert.equal(await btn(p,'重试本机关联').count(),1);
 await btn(p,'重试本机关联').click();await p.locator('.error').filter({hasText:'本机关联仍未完成'}).waitFor();assert.equal(s.imports,1);assert.equal((await recordsOf(p))[0].cloud,undefined);
 await p.evaluate(()=>Storage.prototype.setItem=window.originalSet);await btn(p,'重试本机关联').click();await p.locator('.notice').filter({hasText:'本机关联已完成'}).waitFor();assert.equal(s.imports,1);assert.equal((await recordsOf(p))[0].cloud,id);assert.equal(await btn(p,'重试本机关联').count(),0);assert.equal(await btn(p,'下载云端原图').count(),1);assert.equal(await btn(p,'同步到云端').count(),0);
 await btn(p,'返回相册').click();assert.equal(await cards(p).count(),1);console.log('OBSERVE N4 imports=1 rows=1 native_locks=true detail_refreshed=true');
});
// All five old successful responses are allowed to finish only after B has its own list.
for(const kind of ['gallery','favorite','generate','import','session','cache','download','delete'])await check('late '+kind+' 200 after A logout and B login changes neither storage nor B UI',async()=>{
 const linked=['cache','download','delete'].includes(kind),rec=kind==='import'?[local()]:linked?[local(id)]:[];
 const {page:p,s,context}=await setup({records:rec,images:linked?[row]:[]});let h;
 if(kind==='favorite'){h=s.hold('POST favorites');await choose(p);await btn(p,'★ 已收藏这个模板').click();await p.locator('[aria-label="返回"]').click();}
 if(kind==='generate'){h=s.hold('POST generate');await beginGenerate(p);}
 if(kind==='import'){h=s.hold('POST gallery/import');await nav(p,'画廊');await cards(p).click();await btn(p,'同步到云端').click();await p.locator('[aria-label="返回"]').click();}
 if(kind==='session'){h=s.hold('GET session');await beginGenerate(p);await p.locator('.result-image img').waitFor();await btn(p,'关闭').click();}
 if(kind==='gallery'||kind==='cache'){
  // fresh login runs syncAccount (real UI), while preserving A's cached record.
  await logout(p);if(kind==='cache')await p.evaluate(k=>localStorage.setItem(k,'[]'),GENERATIONS_KEY);
  h=s.hold(kind==='gallery'?'GET gallery':'GET gallery/'+id);s.images[A]=[row];await login(p,A);
 }
 if(kind==='download'||kind==='delete'){
  h=s.hold(kind==='download'?'GET gallery/'+id:'POST gallery/delete');await nav(p,'画廊');await cards(p).click();
  if(kind==='download'){await btn(p,'下载云端原图').click();await p.locator('[aria-label="返回"]').click();}
  else{await btn(p,'删除这张').click();await btn(p,'确认删除').click();await p.locator('.modal-close').click();await p.locator('[aria-label="返回"]').click();}
 }
 await poll(()=>h.started);await logout(p);await login(p,B);await settle(p);const before=await storage(p),writes=await p.evaluate(()=>window.writes.length),downloads=s.downloads;
 h.release();await poll(()=>h.done);await settle(p);assert.deepEqual(await storage(p),before);assert.equal(await p.evaluate(()=>window.writes.length),writes);assert.equal(s.downloads,downloads);assert.equal(await p.locator('.result-image img').count(),0);
 await nav(p,'画廊');assert.equal(await cards(p).filter({hasText:'云端'}).count(),0);assert.equal(await favcards(p).count(),1);assert.match(await favcards(p).innerText(),new RegExp(catalog.find(x=>x.id==='catalog-44-1').name));
 assert.equal(await p.locator('.error').count(),0);assert.equal(await p.locator('.notice').count(),0);assert.deepEqual(s.errors,[]);
});
for(const kind of ['favorite','generate','import','cache'])await check('epoch validated INSIDE delayed native Web Lock: '+kind,async()=>{
 const {page:p,context,s}=await setup({records:kind==='import'?[local()]:[],images:[]});
 const q=await context.newPage();await q.goto(server.url,{waitUntil:'networkidle'});
 const key=kind==='favorite'?STATE_KEY:GENERATIONS_KEY;
 await q.evaluate(key=>{window.held=false;window.lockDone=navigator.locks.request('hairplay.storage.'+key,async()=>{window.held=true;await new Promise(r=>window.releaseLock=r)})},key);await poll(()=>q.evaluate(()=>window.held));
 if(kind==='favorite'){await choose(p);await btn(p,'★ 已收藏这个模板').click();await p.locator('[aria-label="返回"]').click();await poll(()=>s.events.some(e=>e.path==='favorites'&&e.method==='POST'));}
 if(kind==='generate'){await beginGenerate(p);await poll(()=>s.generates===1);}
 if(kind==='import'){await nav(p,'画廊');await cards(p).click();await btn(p,'同步到云端').click();await p.locator('[aria-label="返回"]').click();await poll(()=>s.imports===1);}
 if(kind==='cache'){
  // v2 first publishes the gallery revision under its lock. Let that metadata
  // phase finish, then hold the REAL image response and queue its cache commit
  // behind a second native lock (preserves the original image-cache window).
  await q.evaluate(()=>window.releaseLock());await q.evaluate(()=>window.lockDone);
  await q.route('**/api/gallery/'+id,route=>route.abort());
  await logout(p);s.images[A]=[row];const image=s.hold('GET gallery/'+id);await login(p,A);await poll(()=>image.started);
  await q.evaluate(key=>{window.held=false;window.lockDone=navigator.locks.request('hairplay.storage.'+key,async()=>{window.held=true;await new Promise(r=>window.releaseLock=r)})},key);await poll(()=>q.evaluate(()=>window.held));
  image.release();await poll(()=>image.done);
 }
 await poll(()=>p.evaluate(async()=>{const q=await navigator.locks.query();return q.pending.length>0}));
 await logout(p);const before=await storage(p),n=await p.evaluate(()=>window.writes.length);await q.evaluate(()=>window.releaseLock());await q.evaluate(()=>window.lockDone);await settle(p);
 // Other tab may sync accountFavorites due to normal storage events; no p write is permitted.
 assert.equal(await p.evaluate(()=>window.writes.length),n);assert.equal((await storage(p))[GENERATIONS_KEY],before[GENERATIONS_KEY]);assert.equal(await p.locator('.result-image img').count(),0);assert.equal(await p.locator('.error').count(),0);
});
await check('all preferences without locks: restore/toggle/options/hide have zero writes',async()=>{
 const {page:p}=await setup({session:null,noLocks:true});await p.locator('[aria-label="关闭邀请横幅"]').click();await p.locator('.error').filter({hasText:'Web Locks'}).waitFor();
 await nav(p,'个人资料');await p.locator('uni-button').filter({hasText:'隐私与偏好'}).click();await btn(p,'☑ 记住高级选项偏好').click();await btn(p,'恢复邀请横幅').click();await btn(p,'完成').click();await nav(p,'AI匹配');await p.locator('.advanced-toggle').click();await btn(p,'职业').click();await settle(p);
 assert.deepEqual(await p.evaluate(()=>window.writes),[]);assert.equal((await stateOf(p)).bannerHidden,undefined);assert.equal((await stateOf(p)).rememberOptions,undefined);
});
await check('stale favorites GET cannot resurrect a subsequently cancelled favorite',async()=>{
 const {page:p,context,s}=await setup();const q=await context.newPage();await q.goto(server.url,{waitUntil:'networkidle'});const h=s.hold('GET favorites');
 // A real cross-tab preference write triggers p's storage listener and fresh GET.
 await q.locator('[aria-label="关闭邀请横幅"]').click();await poll(()=>h.started);await q.close();
 await choose(p);await btn(p,'★ 已收藏这个模板').click();await p.locator('.notice').filter({hasText:'已取消收藏'}).waitFor();assert.deepEqual(s.favorites[A],[]);h.release();await poll(()=>h.done);await settle(p);
 await p.locator('[aria-label="返回"]').click();await nav(p,'画廊');const observed={server:s.favorites[A],cards:await favcards(p).count(),cache:ids((await stateOf(p)).accountFavorites.items)};console.log('OBSERVE stale-favorites-GET '+JSON.stringify(observed));assert.equal(observed.cards,0);assert.deepEqual(observed.cache,[]);
});
await check('generation rechecks account before POST after async photo re-encoding',async()=>{
 const {page:p,s}=await setup({favorites:[]});
 await p.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob;window.canvasHeld=false;HTMLCanvasElement.prototype.toBlob=function(...args){if(!window.canvasHeld){window.canvasHeld=true;window.releaseCanvas=()=>original.apply(this,args);}else return original.apply(this,args)}});
 await beginGenerate(p);await poll(()=>p.evaluate(()=>window.canvasHeld));assert.equal(s.generates,0);await logout(p);await login(p,B);await p.evaluate(()=>window.releaseCanvas());await settle(p);await settle(p);
 const posts=s.events.filter(e=>e.path==='generate');console.log('OBSERVE pre-upload-account-change '+JSON.stringify(posts.map(({owner,body})=>({owner,photoBytes:body.photo.length}))));assert.equal(posts.length,0);
});
await check('cross-tab logout/login B invalidates A delayed generation in every tab',async()=>{
 const {page:p,context,s}=await setup({favorites:[]});const q=await context.newPage();await q.goto(server.url,{waitUntil:'networkidle'});
 const h=s.hold('POST generate');await beginGenerate(p);await poll(()=>h.started);await logout(q);await login(q,B);await settle(q);
 const before=await storage(p),refresh=s.hold('GET session');h.release();await poll(()=>h.done);await settle(p);
 const observed={serverSession:s.session,privateModal:await p.locator('.result-image img').count(),rows:(await recordsOf(p)).length,stateChanged:(await storage(p))[STATE_KEY]!==before[STATE_KEY],genChanged:(await storage(p))[GENERATIONS_KEY]!==before[GENERATIONS_KEY]};console.log('OBSERVE cross-tab-account-change '+JSON.stringify(observed));
 if(refresh.started){refresh.release();await poll(()=>refresh.done);}assert.equal(observed.privateModal,0);assert.equal(observed.genChanged,false);
});
console.log('ADVERSARIAL_COMPLETE failures='+issues.length+' names='+JSON.stringify(issues));
}finally{for(const c of contexts)await c.close();await browser.close();await server.close()}
if(issues.length)process.exitCode=1;
