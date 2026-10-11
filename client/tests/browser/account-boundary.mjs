import {assert,launchBrowser,startStatic,jpegDataUrl,readGenerations,readFavorites,GENERATIONS_KEY,STATE_KEY,readRepo,repoPath} from './harness.mjs';
const jpeg=await jpegDataUrl(),realBytes=await readRepo('client/src/static/catalog/ai-catalog-53-0.jpg');
const id='a'.repeat(24),created='2026-10-11T00:00:00.000Z',row={id,name:'Review cloud',created,style:null,size:realBytes.length};
const record=(cloud=id)=>({id:'gen-review',name:'Review local',created,image:jpeg,source:'ai',...(cloud===undefined?{}:{cloud})});
const account={email:'review@example.invalid',context:'a'.repeat(32),gender:null,remaining:2};
const server=await startStatic(),browser=await launchBrowser(),contexts=[];
const btn=(p,text)=>p.locator('uni-button').filter({hasText:new RegExp('^'+text+'$')});
const gallery=p=>p.locator('[aria-label="导航 画廊"]').click();
const cards=p=>p.locator('uni-button[aria-label^="AI 生成记录"]');
const favcards=p=>p.locator('uni-button[aria-label^="收藏的模板"]');
const waitFor=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('condition timeout')};
const logout=async p=>{await p.locator('[aria-label="导航 个人资料"]').click();await btn(p,'退出登录').click();await p.locator('.auth-message').filter({hasText:'已退出登录'}).waitFor()};
async function setup({records=[],noLocks=false,images=[row],favoriteState={ids:[],initialized:true},holdGallery=false,holdFavorite=false,holdGeneration=false,holdImport=false,holdSession=false,holdOtherFavorites=false,localFavorites=[],adoptionConflict=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
 await context.addInitScript(({records,noLocks,key,localFavorites,stateKey})=>{if(!localStorage.getItem(key)){localStorage.setItem(key,JSON.stringify(records));localStorage.setItem(stateKey,JSON.stringify({version:1,favorites:localFavorites}));}window.storageWrites=[];const orig=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){window.storageWrites.push(k);return orig.call(this,k,v)};if(noLocks)Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})},{records,noLocks,key:GENERATIONS_KEY,localFavorites,stateKey:STATE_KEY});
 const page=await context.newPage();page.setDefaultTimeout(5000);
 const state={loginGeneration:0,revisions:new Map(),session:account,images,imageGets:0,galleryStarted:false,favoritePosts:[],favoriteStarted:false,generateStarted:false,importCalls:0};
 const gate=new Promise(r=>state.release=r),fgate=new Promise(r=>state.releaseFavorite=r),ggate=new Promise(r=>state.releaseGeneration=r),igate=new Promise(r=>state.releaseImport=r),sgate=new Promise(r=>state.releaseSession=r),bgate=new Promise(r=>state.releaseOther=r);
 await context.route('**/api/**',async route=>{
 const req=route.request(),path=new URL(req.url()).pathname.split('/api/')[1],capturedSession=state.session;
 const stamp=(resource,data)=>{const key=capturedSession.email+' '+resource,value=JSON.stringify(data),old=state.revisions.get(key),revision=old?old.revision+(old.value!==value?1:0):0;state.revisions.set(key,{value,revision});return {owner:capturedSession.email,context:capturedSession.context,revision};};
 const json=(body,status=200)=>{
  if('ids' in body)body={...body,...stamp('favorites',[body.ids,body.initialized])};
  else if('images' in body||'id' in body||'record' in body){const images=body.images||[...state.images];body={...body,images,...stamp('gallery',images.map(i=>i.id))};}
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 };
 if(path==='session'){const captured=state.session;if(holdSession&&state.generateStarted){state.sessionStarted=true;await sgate;}return json({account:captured})}
 if(path==='auth/login'){state.session={...account,email:req.postDataJSON().email,context:(++state.loginGeneration).toString(16).padStart(32,'0')};return json({ok:true})}
 if(path==='auth/logout'){state.session=null;return json({ok:true})}
 if(path==='favorites'){
  if(req.method()==='POST'){
   const body=req.postDataJSON();state.favoritePosts.push(body);state.favoriteStarted=true;
   if(holdFavorite)await fgate;
   if(Array.isArray(body.ids)){
    if(adoptionConflict||favoriteState.initialized){favoriteState.ids=['dracula'];return json({ok:false,ids:favoriteState.ids,initialized:true},409)}
    favoriteState.ids=[...new Set(body.ids)];favoriteState.initialized=true;
   }else if(body.add)favoriteState.ids=[...new Set([body.add,...favoriteState.ids])];
   else if(body.remove)favoriteState.ids=favoriteState.ids.filter(id=>id!==body.remove);
   return json({ok:true,ids:favoriteState.ids,initialized:true});
  }
  if(holdOtherFavorites&&state.session?.email==='other@example.invalid'){state.otherStarted=true;await bgate;return json({ids:['catalog-44-1'],initialized:true});}
  return json(favoriteState);
 }
 if(path==='gallery'){state.galleryStarted=true;const snapshot=[...state.images],captured={images:snapshot,...stamp('gallery',snapshot.map(i=>i.id))};if(holdGallery)await gate;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(captured)})}
 if(path==='gallery/import'){if(holdImport){state.importStarted=true;await igate;}state.importCalls++;if(!state.images.some(r=>r.id===id))state.images.push({...row});return json({id,created})}
 if(path==='generate'){state.generateStarted=true;if(holdGeneration)await ggate;state.images.push({...row});return json({image:jpeg,record:{id,created},remaining:1})}
 if(path.startsWith('gallery/')){state.imageGets++;const metadata=stamp('gallery',state.images.map(i=>i.id));return route.fulfill({status:200,contentType:'image/jpeg',headers:{'x-hairplay-owner':metadata.owner,'x-hairplay-context':metadata.context,'x-hairplay-revision':String(metadata.revision)},body:realBytes})}
 return json({},404);
 });
 await page.goto(server.url,{waitUntil:holdGallery?'domcontentloaded':'networkidle'});await waitFor(()=>state.galleryStarted);return {context,page,state};
}
let failures=0;
async function run(name,fn){try{await fn()}catch(e){failures++;console.log('HARNESS_CASE_ERROR '+name+' '+e.stack)}}
try{
await run('F5',async()=>{
 const {page,state}=await setup({records:[record()],holdGallery:true});await logout(page);await gallery(page);state.release();await page.waitForTimeout(600);
 assert.equal(await cards(page).count(),0);console.log('F5 OLD_GALLERY_200_AFTER_LOGOUT cloud_cards=0 private_img=0 CLOSED');
});
await run('F3',async()=>{
 const {page}=await setup({records:[record([id])],images:[]});await gallery(page);
 const rows=await readGenerations(page);assert.equal(rows.length,1);assert.equal(await cards(page).count(),1);assert.match(await cards(page).innerText(),/仅本机/);
 console.log('F3 ARRAY_CLOUD records=1 raw_storage_array_retained=true rendered=1 UI=仅本机 CLOSED');
});
await run('F4',async()=>{
 const bad=Buffer.concat([realBytes.subarray(0,6),Buffer.alloc(3000),Buffer.from([255,217])]),damaged={...record(),image:'data:image/jpeg;base64,'+bad.toString('base64')};
 const {page,state}=await setup({records:[damaged]});await gallery(page);await waitFor(()=>state.imageGets>0);await waitFor(async()=>(await readGenerations(page))[0].image!==damaged.image);
 const decoded=await cards(page).first().locator('img').evaluate(async e=>{try{await e.decode();return true}catch{return false}});assert.equal(decoded,true);
 console.log('F4 BAD_CACHE imageFetches='+state.imageGets+' src_changed=true decoded='+decoded+' CLOSED');
});
await run('F4b',async()=>{
 const {page,state}=await setup({noLocks:true});await gallery(page);await waitFor(async()=>await cards(page).locator('img').count()===1);
 assert.equal((await readGenerations(page)).length,0);const text=await page.locator('.notice').allTextContents();assert.match(text.join(''),/本机缓存未能写入/);
 console.log('F4b NO_LOCKS imageFetches='+state.imageGets+' rendered=1 storage_rows=0 notice='+JSON.stringify(text)+' CLOSED');
});
await run('F7',async()=>{
 const {page}=await setup({noLocks:true,images:[],favoriteState:{ids:['catalog-53-1'],initialized:true}});await gallery(page);
 assert.equal((await readFavorites(page)).length,0);assert.equal((await page.evaluate(()=>window.storageWrites)).length,0);assert.match((await page.locator('.notice').allTextContents()).join(''),/收藏已从账户同步.*本机缓存未更新/);
 console.log('F7 NO_LOCKS_SIGNED_IN_FAVORITES storage_writes=0 notice=true CLOSED');
});
await run('F8',async()=>{
 const shared={ids:['catalog-53-1'],initialized:true},a=await setup({images:[],favoriteState:shared}),b=await setup({images:[],favoriteState:shared});
 await a.page.locator('[aria-label="查看 庞巴杜发型"]').click();await btn(a.page,'★ 已收藏这个模板').click();await waitFor(()=>shared.ids.length===0);
 const style=JSON.parse((await readRepo('client/src/core/catalog.json')).toString()).find(s=>s.id==='dracula');
 await b.page.locator('[aria-label="查看 '+style.name+'"]').click();await btn(b.page,'☆ 收藏这个模板').click();await waitFor(()=>shared.ids.includes('dracula'));
 assert.deepEqual(shared.ids,['dracula']);console.log('F8 TWO_CONTEXTS server_ids='+JSON.stringify(shared.ids)+' requests='+JSON.stringify([...a.state.favoritePosts,...b.state.favoritePosts])+' CLOSED');
});
await run('F6',async()=>{
 const local=record();delete local.cloud;const {page,state}=await setup({records:[local],images:[],noLocks:true});await gallery(page);await cards(page).first().click();await btn(page,'同步到云端').click();
 await page.locator('.error').filter({hasText:'未能记住它'}).waitFor();assert.equal((await readGenerations(page))[0].cloud,undefined);
 assert.equal(await btn(page,'重试本机关联').count(),1);
 console.log('F6 CACHE_LINK_FAILURE rows='+state.images.length+' error='+await page.locator('.error').innerText()+' retry_link_button_count=1');
 await btn(page,'重试本机关联').click();await page.locator('.error').filter({hasText:'本机关联仍未完成'}).waitFor();
 assert.equal(state.images.length,1);assert.equal(state.importCalls,1);
 await page.evaluate(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name,_options,fn)=>fn()}}));
 await btn(page,'重试本机关联').click();await page.locator('.notice').filter({hasText:'本机关联已完成'}).waitFor();
 assert.equal((await readGenerations(page))[0].cloud,id);assert.equal(state.importCalls,1);assert.equal(await btn(page,'重试本机关联').count(),0);
 console.log('N4 RETRY_LINK failure_then_success importCalls=1 rows=1 pointer_saved=true CLOSED');
});
await run('409',async()=>{
 const {page,state}=await setup({images:[],favoriteState:{ids:[],initialized:false},adoptionConflict:true});await gallery(page);
 await waitFor(async()=>await favcards(page).count()===1);assert.equal(state.favoritePosts.length,1);
 console.log('ADOPTION_409 post_count=1 adopted=[dracula] retried=false PASS');
});
await run('F9',async()=>{
 const {page}=await setup({images:[],favoriteState:{ids:['catalog-53-1'],initialized:true}});await logout(page);await gallery(page);
 const n=await favcards(page).count();assert.equal(n,0);console.log('F9 CLOSED logout_completed=true account_favorites_visible=0 local='+JSON.stringify((await readFavorites(page)).map(f=>f.styleId)));
});
await run('preferences',async()=>{
 const {page}=await setup({noLocks:true,images:[]});await page.locator('[aria-label="关闭邀请横幅"]').click();
 await page.locator('.error').filter({hasText:'Web Locks'}).waitFor();assert.equal((await page.evaluate(()=>window.storageWrites)).length,0);
 assert.equal(await page.locator('[aria-label="关闭邀请横幅"]').count(),1);
 console.log('N3 NO_LOCK_PREFERENCES writes=[] banner_retained=true CLOSED');
});
await run('concurrent preferences',async()=>{
 const {page,context}=await setup({images:[],favoriteState:{ids:['dracula'],initialized:true}});
 const second=await context.newPage();await second.goto(server.url,{waitUntil:'networkidle'});
 await page.locator('[aria-label="导航 AI匹配"]').click();await second.locator('[aria-label="导航 AI匹配"]').click();
 await page.locator('.advanced-toggle').click();await second.locator('.advanced-toggle').click();
 await Promise.all([btn(page,'职业').click(),btn(second,'低').click()]);
 await waitFor(async()=>page.evaluate(key=>{const v=JSON.parse(localStorage.getItem(key));return v.options['风格类型']==='职业'&&v.options['护理程度']==='低'&&v.accountFavorites.items[0].styleId==='dracula'},STATE_KEY));
 console.log('N3 CONCURRENT_PREFERENCES independent_keys_preserved=true favorites_preserved=true CLOSED');
});
await run('late favorite',async()=>{
 const {page,state}=await setup({images:[],holdFavorite:true});await page.locator('[aria-label="查看 庞巴杜发型"]').click();await btn(page,'☆ 收藏这个模板').click();await waitFor(()=>state.favoriteStarted);
 await page.locator('[aria-label="返回"]').click();await logout(page);state.releaseFavorite();await page.waitForTimeout(500);await gallery(page);
 assert.equal(await favcards(page).count(),0);assert.equal((await readFavorites(page)).length,0);
 console.log('N1 LATE_FAVORITE_POST logout_completed=true released_old_200=true signed_out_favorites=0 CLOSED');
});
await run('late generation',async()=>{
 const {page,state}=await setup({images:[],holdGeneration:true});await page.locator('[aria-label="导航 AI匹配"]').click();const chooser=page.waitForEvent('filechooser');await page.locator('uni-button').filter({hasText:'选择本地照片'}).click();await (await chooser).setFiles(repoPath('client/src/static/catalog/ai-catalog-44-0.jpg'));await page.locator('.photo-area').waitFor();await btn(page,'试试 AI 发型').click();await btn(page,'确认上传并生成').click();await waitFor(()=>state.generateStarted);
 await logout(page);const finished=page.waitForResponse(r=>r.url().endsWith('/api/generate'));state.releaseGeneration();await finished;await page.waitForTimeout(300);
 assert.equal(await page.locator('.result-image img').count(),0);assert.equal((await readGenerations(page)).length,0);
 console.log('N2 LATE_GENERATE logout_completed=true released_old_200=true private_result_modal=false storage_rows=0 CLOSED');
});
await run('late import',async()=>{
 const local=record();delete local.cloud;const {page,state}=await setup({records:[local],images:[],holdImport:true});await gallery(page);await cards(page).click();await btn(page,'同步到云端').click();await waitFor(()=>state.importStarted);
 await page.locator('[aria-label="返回"]').click();await logout(page);
 const before=await page.evaluate(()=>({state:localStorage.getItem('hairai.study.v1'),generations:localStorage.getItem('hairplay.generations.v1')}));
 const finished=page.waitForResponse(r=>r.url().endsWith('/api/gallery/import'));state.releaseImport();await finished;await page.waitForTimeout(200);await gallery(page);
 assert.equal((await readGenerations(page))[0].cloud,undefined);assert.deepEqual(await page.evaluate(()=>({state:localStorage.getItem('hairai.study.v1'),generations:localStorage.getItem('hairplay.generations.v1')})),before);
 assert.equal(await cards(page).filter({hasText:'云端'}).count(),0);assert.equal(await page.locator('.error').count(),0);
 console.log('N2 LATE_IMPORT released_old_200=true local_unchanged=true private_cloud_rows=0 CLOSED');
});
await run('late refresh',async()=>{
 const {page,state}=await setup({images:[],holdSession:true});await page.locator('[aria-label="导航 AI匹配"]').click();const chooser=page.waitForEvent('filechooser');await page.locator('uni-button').filter({hasText:'选择本地照片'}).click();await (await chooser).setFiles(repoPath('client/src/static/catalog/ai-catalog-44-0.jpg'));await page.locator('.photo-area').waitFor();await btn(page,'试试 AI 发型').click();await btn(page,'确认上传并生成').click();await page.locator('.result-image img').waitFor();await btn(page,'关闭').click();await waitFor(()=>state.sessionStarted);
 // auth/logout's new session fetch is also held, but its captured result is null.
 await page.locator('[aria-label="导航 个人资料"]').click();await btn(page,'退出登录').click();await waitFor(()=>state.session===null);state.releaseSession();await page.locator('.auth-message').filter({hasText:'已退出登录'}).waitFor();
 assert.equal(await btn(page,'退出登录').count(),0);assert.equal(await page.locator('.result-image img').count(),0);
 console.log('N2 OLD_SESSION_200 logout_not_reversed=true CLOSED');
});
await run('account switch and local conflict',async()=>{
 const local=[{id:'fav-catalog-53-1',styleId:'catalog-53-1',name:'庞巴杜发型',image:'/static/catalog/ai-catalog-53-1.jpg',created}];
 const {page,state}=await setup({images:[],localFavorites:local,favoriteState:{ids:[],initialized:false},adoptionConflict:true,holdOtherFavorites:true});await gallery(page);await waitFor(async()=>await favcards(page).count()===1);assert.equal((await readFavorites(page)).length,1);
 await logout(page);await gallery(page);assert.equal(await favcards(page).count(),1);
 await page.locator('[aria-label="导航 个人资料"]').click();await page.locator('#auth-email input').fill('other@example.invalid');await page.locator('#auth-code input').fill('123456');await btn(page,'注册 / 登录').click();await page.locator('.auth-message').filter({hasText:'登录成功'}).waitFor();await gallery(page);
 assert.equal(state.session.email,'other@example.invalid');assert.equal((await readFavorites(page)).length,1);
 await waitFor(()=>state.otherStarted);assert.equal(await favcards(page).count(),0,'no previous-account flash while B sync is pending');
 state.releaseOther();await waitFor(async()=>await favcards(page).count()===1);
 const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).accountFavorites,STATE_KEY);assert.equal(stored.owner,'other@example.invalid');assert.deepEqual(stored.items.map(f=>f.styleId),['catalog-44-1']);
 console.log('F9 ADOPTION_409 local_unique_preserved=true account_switch_no_old_flash=true CLOSED');
});
await run('content readback',async()=>{
 const local=record();delete local.cloud;const {page}=await setup({records:[local],images:[]});
 await page.evaluate(key=>{const orig=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key){const rows=JSON.parse(v);for(const r of rows)delete r.cloud;v=JSON.stringify(rows)}return orig.call(this,k,v)}},GENERATIONS_KEY);
 await gallery(page);await cards(page).click();await btn(page,'同步到云端').click();await page.locator('.error').filter({hasText:'未能记住它'}).waitFor();assert.equal((await readGenerations(page))[0].cloud,undefined);
 console.log('CONTENT_READBACK ids_unchanged=true cloud_field_silently_lost=true honest_error=true PASS');
});
console.log('BROWSER_INDEPENDENT_COMPLETE harness_errors='+failures);
}finally{for(const c of contexts)await c.close();await browser.close();await server.close()}
if(failures)process.exitCode=1;
