// Deterministic cross-tab interleaving for the local gallery.
//
// Two tabs delete different records. Tab B is stopped *before* it takes the
// storage lock, using a stale UI snapshot (the real-world case: the user opened
// the delete dialog, another tab deleted first, then the user confirmed). The
// check is that B re-reads storage inside the lock, so nothing is resurrected,
// and that A is never blocked by B.
import {assert, GENERATIONS_KEY, jpegDataUrl, launchBrowser, startStatic} from './harness.mjs';

const K = GENERATIONS_KEY;
const image = await jpegDataUrl();
const record = id => ({id, name: id, image, created: '2026-10-10T00:00:00Z', source: 'ai'});

const server = await startStatic({
	handler: (req, res, url) => {
		if (!url.pathname.includes('/api/')) return false;
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end(JSON.stringify({account: null}));
		return true;
	},
});
const url = server.url;
const browser = await launchBrowser();
const button=(p,name)=>p.locator('uni-button').filter({hasText:new RegExp('^'+name+'$')});
const gallery=async p=>{await p.locator('[aria-label="导航 画廊"]').click();await p.locator('.gallery-section').first().waitFor();};
const ids=p=>p.evaluate(K=>JSON.parse(localStorage.getItem(K)||'[]').map(r=>r.id),K);
const seed=async(p)=>{await p.evaluate(({K,list})=>{localStorage.setItem(K,JSON.stringify(list));localStorage.setItem('hairai.study.v1',JSON.stringify({version:1,bannerHidden:true,rememberOptions:true,options:{},records:[]}));},{K,list:[record('gen-A'),record('gen-B')]});await p.reload({waitUntil:'networkidle'});await gallery(p);};

const errors=[];
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});
 const a=await ctx.newPage(),b=await ctx.newPage();
 for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 await a.goto(url,{waitUntil:'networkidle'});await seed(a);
 await b.goto(url,{waitUntil:'networkidle'});await gallery(b);
 assert.deepEqual(await ids(a),['gen-A','gen-B']);

 // B opens the dialog for gen-B (its UI snapshot now holds both records) and
 // then blocks just before requesting the storage lock.
 await b.locator('[aria-label="AI 生成记录 gen-B"]').click();
 await button(b,'删除这张').click();
 await b.evaluate(name=>{
  const original=navigator.locks.request.bind(navigator.locks);
  window.__gated=false;window.__release=null;
  navigator.locks.request=(lock,bOptions,fn)=>{
   if(lock!==name)return original(lock,bOptions,fn);
   const callback=typeof bOptions==='function'?bOptions:fn,options=typeof bOptions==='function'?undefined:bOptions;
   window.__gated=true;
   return new Promise((resolve,reject)=>{window.__release=()=>{try{resolve(original(lock,options,callback))}catch(e){reject(e)}};});
  };
 },'hairplay.storage.'+K);
 await button(b,'确认删除').click();
 for(let i=0;i<50&&!(await b.evaluate(()=>window.__gated));i++)await b.waitForTimeout(100);
 assert.equal(await b.evaluate(()=>window.__gated),true,'tab B must reach the storage lock');

 // A deletes gen-A while B is stopped in front of the lock: A must not be blocked.
 await a.locator('[aria-label="AI 生成记录 gen-A"]').click();
 await button(a,'删除这张').click();
 await button(a,'确认删除').click();
 await a.locator('.notice').filter({hasText:'已从本机删除这张生成图片'}).first().waitFor({timeout:10000});
 assert.deepEqual(await ids(a),['gen-B'],'A must delete its record while the other tab is stopped');

 // Release B: it must re-read inside the lock and delete only its own record.
 await b.evaluate(()=>window.__release());
 await b.locator('.notice').filter({hasText:'已从本机删除这张生成图片'}).first().waitFor({timeout:10000});
 assert.deepEqual(await ids(a),[],'a stale snapshot must not resurrect the record deleted in the other tab');
 assert.equal(await b.locator('[aria-label^="AI 生成记录"]').count(),0);
 await a.reload({waitUntil:'networkidle'});await gallery(a);
 assert.equal(await a.locator('[aria-label^="AI 生成记录"]').count(),0,'reload must not resurrect deleted records');
 assert.deepEqual((await a.locator('.error').allInnerTexts()).filter(Boolean),[],'no spurious errors');

 // Without Web Locks there is no way to serialize a read-modify-write across
 // tabs, so the app must fail closed: no unlocked write and no false success.
 const noLock=await browser.newContext({viewport:{width:390,height:844}});
 await noLock.addInitScript(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:undefined}));
 const x=await noLock.newPage(),y=await noLock.newPage();
 for(const p of [x,y])p.on('pageerror',e=>errors.push(e.message));
 await x.goto(url,{waitUntil:'networkidle'});await seed(x);
 await y.goto(url,{waitUntil:'networkidle'});await gallery(y);
 assert.equal(await x.evaluate(()=>typeof navigator.locks),'undefined');
 for(const p of [x,y]){
  await p.evaluate(()=>{window.__writes=0;const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k)==='hairplay.generations.v1')window.__writes++;return o.call(this,k,v)};});
  await p.locator('[aria-label="AI 生成记录 gen-A"]').click();
  await button(p,'删除这张').click();
  await button(p,'确认删除').click();
  await p.locator('.error').first().waitFor({timeout:10000});
  assert.match(await p.locator('.error').first().innerText(),/Web Locks/,'a runtime without locks must say so');
  assert.equal(await p.evaluate(()=>window.__writes),0,'no write may happen without a lock');
  assert.deepEqual((await p.locator('.notice').filter({hasText:'已从本机删除'}).allInnerTexts()),[],'no false success without a lock');
  await button(p,'取消').click().catch(()=>{});
  await p.keyboard.press('Escape').catch(()=>{});
 }
 assert.deepEqual(await ids(x),['gen-A','gen-B'],'a delete must not happen unlocked');
 await noLock.close();

 // A tab that wedges inside the lock must not block the user forever, and the
 // give-up path must never write an unsynchronized result.
 await seed(a);
 const stuck=await ctx.newPage();stuck.on('pageerror',e=>errors.push(e.message));
 await stuck.goto(url,{waitUntil:'networkidle'});
 await stuck.evaluate(async name=>{let release;window.__releaseStuck=new Promise(r=>{release=r});window.__releaseNow=release;
  // Hold the same lock for longer than the client-side acquisition timeout.
  navigator.locks.request(name,()=>window.__releaseStuck);},'hairplay.storage.'+K);
 await stuck.waitForTimeout(300);
 await a.locator('[aria-label="AI 生成记录 gen-A"]').click();
 await button(a,'删除这张').click();
 await button(a,'确认删除').click();
 await a.locator('.error').first().waitFor({timeout:10000});
 const stuckError=await a.locator('.error').first().innerText();
 assert.match(stuckError,/另一个标签页正在写入|未生效|失败/,'a blocked lock must be reported, not silently ignored');
 assert.deepEqual(await ids(a),['gen-A','gen-B'],'the give-up path must not write an unsynchronized result');
 await stuck.evaluate(()=>window.__releaseNow());
 await a.reload({waitUntil:'networkidle'});await gallery(a);
 assert.equal(await a.locator('[aria-label^="AI 生成记录"]').count(),2,'records must still be there after a refused delete');
 await stuck.close();
 await ctx.close();
 assert.deepEqual(errors,[],'no page errors');
 console.log('GALLERY_LOCK_OK cross_tab_serialized=OK stale_snapshot_no_resurrect=OK no_locks_fail_closed=OK locked_tab_reported=OK no_unsynchronized_write=OK errors=0');
}catch(e){console.error('GALLERY_LOCK_FAIL',e.message);process.exitCode=1}
finally{await browser.close();server.close()}
