import {fixture,btn,nav,browser,assert,GENERATIONS_KEY} from './real-fixture.mjs';
import {readRepo} from './harness.mjs';
const compact=rows=>rows.map(({id,name,created})=>({id,name,created}));
const all=[];
let f;
try{
 f=await fixture({noBC:process.env.NO_BC==='1'});
 const {p:one,context,store,a}=f;
 const savedA=store.addImage(a.id,{name:'明确目标 A'},await readRepo('client/src/static/catalog/ai-catalog-44-0.jpg'));
 const savedB=store.addImage(a.id,{name:'明确目标 B'},await readRepo('client/src/static/catalog/ai-catalog-44-1.jpg'));
 assert.notEqual(savedA.id,savedB.id);
 const fixtures=compact(store.listImages(a.id));
 const two=await context.newPage();two.setDefaultTimeout(5000);
 const requests=[],responses=[],pending=[],errors=[];
 const labels=new Map([[one,'one'],[two,'two']]);
 context.on('request',req=>{if(req.url().endsWith('/gallery/delete')){const entry={tab:labels.get(req.frame().page()),body:req.postDataJSON(),context:req.headers()['x-hairplay-context']};requests.push(entry);console.log('REAL_DELETE_REQUEST '+JSON.stringify(entry));}});
 context.on('response',res=>{if(res.url().endsWith('/gallery/delete'))pending.push((async()=>{const entry={tab:labels.get(res.request().frame().page()),status:res.status(),body:await res.json()};responses.push(entry);console.log('REAL_DELETE_RESPONSE '+JSON.stringify(entry));})());});
 for(const [p,label] of labels){
  p.on('pageerror',e=>errors.push(e.message));
  p.on('console',m=>{if(m.text().startsWith('CLICK_REAL '))console.log(m.text());});
  await p.addInitScript(label=>document.addEventListener('click',e=>{if(e.target.closest('uni-button')?.textContent!=='确认删除')return;console.log('CLICK_REAL '+JSON.stringify({tab:label,detail:document.querySelector('.generated-image')?document.querySelector('.section-title')?.textContent:null,modal:document.querySelector('.modal-copy')?.textContent}));},true),label);
  await p.goto(f.url,{waitUntil:'networkidle'});
  await p.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'[]').length===2,GENERATIONS_KEY);
  await nav(p,'画廊');
 }
 const selections=[];
 for(const [p,label,name] of [[one,'one','明确目标 A'],[two,'two','明确目标 B']]){
  await p.locator('uni-button[aria-label="AI 生成记录 '+name+'"]').click();
  await btn(p,'删除这张').click();
  const selected={tab:label,...fixtures.find(r=>r.name===name),detail:await p.locator('.section-title').innerText(),modal:await p.locator('.modal-copy').innerText()};
  selections.push(selected);console.log('REAL_SELECTED '+JSON.stringify(selected));
 }
 const cookieOwner=store.session((await context.cookies()).find(c=>c.name==='hairplay').value)?.email;
 assert.equal(cookieOwner,a.email);assert.equal(await one.evaluate(()=>typeof navigator.locks?.request),'function');assert.equal(await two.evaluate(()=>typeof navigator.locks?.request),'function');
 // Hold the REAL first successful delete 200 before it reaches its tab/cache.
 let release, captured;const hold=new Promise(r=>release=r);
 let ready;const readyPromise=new Promise(r=>ready=r);
 await one.route('**/api/gallery/delete',async route=>{
  const res=await route.fetch();captured={status:res.status(),body:await res.json()};
  console.log('HELD_REAL_200 '+JSON.stringify(captured));ready();await hold;await route.fulfill({response:res});
 });
 await btn(one,'确认删除').click();await readyPromise;
 assert.equal(captured.status,200);assert.equal(captured.body.revision,3);
 await btn(two,'确认删除').click();
 await two.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'[]').length===0,GENERATIONS_KEY);
 release();
 await one.waitForFunction(()=>!document.querySelector('.generated-image'));
 await one.waitForTimeout(300);await Promise.all(pending);
 const ui=await two.evaluate(()=>({detail:document.querySelector('.generated-image')?document.querySelector('.section-title')?.textContent:null,modal:document.querySelector('.modal-copy')?.textContent,errors:[...document.querySelectorAll('.error')].map(e=>e.textContent),notices:[...document.querySelectorAll('.notice')].map(e=>e.textContent)}));
 const result={noBC:process.env.NO_BC==='1',cookieOwner,nativeLocks:true,fixtures,selections,requests,responses,server:store.gallerySnapshot(a.id),ui,pageErrors:errors};
 console.log('REAL_RESULT '+JSON.stringify(result));
 assert.equal(requests.length,2);
 assert.deepEqual(new Set(requests.map(r=>r.body.id)),new Set([savedA.id,savedB.id]));
 assert.equal(responses.length,2);assert.ok(responses.every(r=>r.status===200&&r.body.deleted));
 assert.deepEqual(responses.map(r=>r.body.revision),[4,3]);
 assert.deepEqual(ui.errors,[]);assert.deepEqual(errors,[]);
 // Product contract assertion: both explicit selected targets should be deleted.
 assert.equal(store.countImages(a.id),0,'both explicitly selected and confirmed account images must be gone');
 console.log('REAL_TWO_REQUESTS_REVERSED_200_PASS');
}finally{await f?.close();await browser.close();}
