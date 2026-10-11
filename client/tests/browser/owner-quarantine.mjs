import {fixture,begin,btn,nav,poll,browser,assert} from './real-fixture.mjs';
const f=await fixture();let releaseSession;
try{
 const {p,context,s,store,a,b}=f;s.holdUpstream=true;await begin(p);await poll(()=>!!s.release);
 let sessionHeld=false;const gate=new Promise(r=>releaseSession=r);
 await p.route('**/api/session',async route=>{const response=await route.fetch();assert.equal((await response.json()).account.email,b.email);sessionHeld=true;await gate;await route.fulfill({response}).catch(()=>{});});
 // A real API login from a second document (e.g. an older tab without the new BC protocol).
 // No forged storage event or synthetic account identity. The Cookie is set by createApp.
 const q=await context.newPage();await q.goto(new URL('api/session',f.url).href);
 const login=await q.evaluate(async ({email,code})=>{const r=await fetch('auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,code})});return r.status;},{email:b.email,code:f.codeB});assert.equal(login,200);
 const cookie=(await context.cookies()).find(c=>c.name==='hairplay');assert.equal(store.session(cookie.value).email,b.email);
 // Loading new B app writes a real B-owned cache under native Web Locks.
 await q.goto(f.url,{waitUntil:'networkidle'});await poll(()=>sessionHeld);await q.close();
 const before=await p.evaluate(()=>({state:localStorage.getItem('hairai.study.v1'),gen:localStorage.getItem('hairplay.generations.v1'),writes:window.reviewWrites.length}));
 assert.equal(JSON.parse(before.state).accountFavorites.owner,b.email);
 const received=p.waitForResponse(r=>r.url().endsWith('/api/generate'));s.release();await received;await p.waitForTimeout(600);
 const after=await p.evaluate(()=>({state:localStorage.getItem('hairai.study.v1'),gen:localStorage.getItem('hairplay.generations.v1')}));
 const obs={cookieOwner:store.session(cookie.value).email,sessionHeld,cacheOwnerBefore:JSON.parse(before.state).accountFavorites.owner,cacheOwnerAfter:JSON.parse(after.state).accountFavorites.owner,privateModal:await p.locator('.result-image img').count(),privateDataUrl:await p.locator('.result-image img').count()?await p.locator('.result-image img').getAttribute('src').then(x=>x.startsWith('data:image/jpeg')):false,lateWrites:await p.evaluate(n=>window.reviewWrites.slice(n),before.writes),generationStorageChanged:before.gen!==after.gen,A_images:store.countImages(a.id),B_images:store.countImages(b.id)};
 console.log('OWNER_MISMATCH '+JSON.stringify(obs));
 assert.equal(obs.privateModal,0);assert.deepEqual(obs.lateWrites,[]);console.log('OWNER_MISMATCH PASS');
}finally{releaseSession?.();await f.close();await browser.close()}
